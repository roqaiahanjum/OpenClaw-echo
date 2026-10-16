import { ModelRouter } from "./router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export interface PlanStep {
    stepNumber: number;
    description: string;
    suggestedTool?: string;
}

export interface ExecutionPlan {
    goal: string;
    steps: PlanStep[];
}

export interface ComplexityResult {
    isComplex: boolean;
    reason: string;
    localPlan?: ExecutionPlan;
}

/**
 * Fast Deterministic Complexity Guard
 * Evaluates whether a prompt is simple or multi-step/complex without calling an LLM.
 */
export function evaluatePlanComplexity(input: string, availableTools: string[]): ComplexityResult {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const words = trimmed.split(/\s+/);

    // 1. Detect multi-step / research-heavy conjunctions
    const complexKeywords = [
        "and then", "first", "second", "after that", "finally",
        "compare", "contrast", "research and write", "analyze and report",
        "audit and fix", "create file and run", "multi-step", "detailed report"
    ];

    for (const kw of complexKeywords) {
        if (lower.includes(kw)) {
            return {
                isComplex: true,
                reason: `Input contains multi-step keyword "${kw}".`
            };
        }
    }

    // 2. Detect long/complex input prompts (> 15 words)
    if (words.length > 15) {
        return {
            isComplex: true,
            reason: `Input length (${words.length} words) exceeds simple prompt threshold.`
        };
    }

    // 3. Simple direct search query (e.g., "search latest AI news")
    if (lower.startsWith("search") || lower.startsWith("find") || lower.startsWith("look up")) {
        return {
            isComplex: false,
            reason: "Simple direct search query.",
            localPlan: {
                goal: input,
                steps: [
                    { stepNumber: 1, description: "Execute search query", suggestedTool: "web_search" },
                    { stepNumber: 2, description: "Summarize search findings", suggestedTool: undefined }
                ]
            }
        };
    }

    // 4. Simple conversational or direct prompt
    return {
        isComplex: false,
        reason: "Simple direct query under complexity threshold.",
        localPlan: {
            goal: input,
            steps: [
                { stepNumber: 1, description: "Direct answer or single tool execution", suggestedTool: undefined }
            ]
        }
    };
}

/**
 * Planner Engine
 * Decomposes incoming user requests into a structured execution plan before tool execution.
 */
export async function generatePlan(input: string, availableTools: string[], parentSignal?: AbortSignal): Promise<ExecutionPlan | null> {
    try {
        const router = ModelRouter.getInstance();
        if (router.isInFallbackMode()) {
            console.log("[Planner] Router in fallback mode — Skipping Gemini planner call.");
            return null;
        }

        const plannerPrompt = `You are the OpenClaw Execution Planner.
Your task is to analyze the user request and break it down into a concise step-by-step execution plan (max 3-4 steps).
Available Tools: ${availableTools.join(", ")}.

Return ONLY valid JSON matching this schema, without any markdown formatting or extra text:
{
  "goal": "summary of goal",
  "steps": [
    { "stepNumber": 1, "description": "description of step 1", "suggestedTool": "tool_name or null" }
  ]
}`;

        const messages = [
            new SystemMessage(plannerPrompt),
            new HumanMessage(input)
        ];

        const controller = new AbortController();
        const timeoutMs = 7000; // 7s strict timeout to prevent orchestrator stalls
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        if (parentSignal) {
            if (parentSignal.aborted) {
                clearTimeout(timer);
                return null;
            }
            parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        let response: any;
        try {
            response = await router.invoke(messages, "planner", { signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }

        let rawContent = response.content as string;
        rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
        
        const parsed = JSON.parse(rawContent);
        if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
            console.log(`[Planner] ✅ Plan generated via LLM with ${parsed.steps.length} steps.`);
            return {
                goal: parsed.goal || input,
                steps: parsed.steps
            };
        }
        return null;
    } catch (error: any) {
        console.warn("[Planner] Plan generation skipped or timed out:", error.message);
        return null;
    }
}

/**
 * Smart Planner Wrapper (Phase 4B)
 * Uses evaluatePlanComplexity to bypass LLM planning on simple prompts or fallback mode.
 */
export async function generateSmartPlan(input: string, availableTools: string[], parentSignal?: AbortSignal): Promise<ExecutionPlan | null> {
    if (parentSignal?.aborted) {
        return null;
    }
    const check = evaluatePlanComplexity(input, availableTools);
    const router = ModelRouter.getInstance();
    if (router.isInFallbackMode()) {
        console.log(`[PlannerGuard] BYPASSED LLM — Router in Fallback Mode (Saved 1 Gemini API Call)`);
        return check.localPlan || { goal: input, steps: [{ stepNumber: 1, description: "Direct execution", suggestedTool: undefined }] };
    }

    if (!check.isComplex && check.localPlan) {
        console.log(`[PlannerGuard] BYPASSED LLM — ${check.reason} (Saved 1 Gemini API Call)`);
        return check.localPlan;
    }

    console.log(`[PlannerGuard] COMPLEX — ${check.reason}. Invoking LLM planner with 7s budget...`);
    const plan = await generatePlan(input, availableTools, parentSignal);
    if (parentSignal?.aborted) {
        return null;
    }
    if (!plan) {
        if (check.localPlan) {
            console.log(`[PlannerGuard] Planner timed out or failed — Falling back to deterministic local plan.`);
            return check.localPlan;
        }
        console.log(`[PlannerGuard] Planner timed out or failed on complex prompt — Falling back to structured multi-step plan.`);
        return {
            goal: input,
            steps: [
                { stepNumber: 1, description: "Gather context and relevant information", suggestedTool: undefined },
                { stepNumber: 2, description: "Execute tools to fulfill requested actions", suggestedTool: undefined },
                { stepNumber: 3, description: "Validate result and synthesize comprehensive output", suggestedTool: undefined }
            ]
        };
    }
    return plan;
}

export function formatPlanForPrompt(plan: ExecutionPlan): string {
    if (!plan || !plan.steps || plan.steps.length === 0) return "";

    let formatted = `\n\n--- EXECUTION PLAN ---\nGoal: ${plan.goal}\nSteps:\n`;
    plan.steps.forEach((s) => {
        const toolStr = s.suggestedTool ? ` (Suggested Tool: ${s.suggestedTool})` : "";
        formatted += `${s.stepNumber}. ${s.description}${toolStr}\n`;
    });
    formatted += `Execute these steps sequentially using appropriate tools when needed.`;

    return formatted;
}

import { ACPTask } from "../agents/types";

/**
 * Decomposes a multi-step user prompt into structured ACP Tasks for SubAgentManager delegation.
 */
export function decomposeIntoACPTasks(userPrompt: string, parentId?: string): ACPTask[] {
    const lower = userPrompt.toLowerCase();
    const tasks: ACPTask[] = [];
    const rootId = parentId || `acp_root_${Date.now()}`;

    const codingKeywords = [
        "code", "script", "write a", "function", "typescript", "javascript", "python",
        "create file", "create a file", "write file", "save file", "make file", "generate file",
        "file in sandbox", ".ts", ".js", ".py", ".json", "sandbox file", "generate a"
    ];
    const isFileCreation = (
        (lower.includes("create") || lower.includes("write") || lower.includes("generate") || lower.includes("make") || lower.includes("save")) &&
        (lower.includes("file") || lower.includes(".ts") || lower.includes(".js") || lower.includes("script") || lower.includes("sandbox") || lower.includes("example"))
    );
    const needsCoding = isFileCreation || codingKeywords.some(kw => lower.includes(kw));

    const needsResearch = (lower.includes("research") || lower.includes("benefits of") || lower.includes("history of") || lower.includes("turing")) &&
        !(isFileCreation && !lower.includes("research") && !lower.includes("benefits"));

    const needsBrowser = (lower.includes("url") || lower.includes("http://") || lower.includes("https://") || lower.includes("web page") || lower.includes("scrape") || lower.includes("fetch page") || lower.includes("browse") || (lower.includes("documentation") && (lower.includes("browse") || lower.includes("official") || lower.includes("online")))) &&
        !(isFileCreation && !lower.includes("browse") && !lower.includes("http") && !lower.includes("scrape"));

    const infoGatheringTaskIds: string[] = [];
    const resTaskId = `task_res_${Date.now()}_1`;
    const browTaskId = `task_brow_${Date.now()}_2`;
    const codeTaskId = `task_code_${Date.now()}_3`;

    if (needsResearch) {
        infoGatheringTaskIds.push(resTaskId);
        tasks.push({
            taskId: resTaskId,
            parentId: rootId,
            targetAgent: 'research',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt },
            maxDepth: 2,
            dependsOn: []
        });
    }

    if (needsBrowser) {
        infoGatheringTaskIds.push(browTaskId);
        let browserUrl: string | undefined = undefined;
        const urlMatch = userPrompt.match(/https?:\/\/[^\s]+/i);
        if (urlMatch) {
            browserUrl = urlMatch[0];
        } else if (lower.includes("typescript")) {
            browserUrl = "https://www.typescriptlang.org/docs/";
        }

        tasks.push({
            taskId: browTaskId,
            parentId: rootId,
            targetAgent: 'browser',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt, url: browserUrl },
            maxDepth: 2,
            dependsOn: []
        });
    }

    if (needsCoding) {
        let fileName: string | undefined = undefined;
        const fileMatch = userPrompt.match(/(?:named|called|file|into|save|create)\s+([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i) ||
                          userPrompt.match(/([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i);
        if (fileMatch) {
            fileName = fileMatch[1];
        } else if (lower.includes("typescript") && (lower.includes("example") || lower.includes("agent"))) {
            fileName = "typescript_ai_agent_example.ts";
        }

        tasks.push({
            taskId: codeTaskId,
            parentId: rootId,
            targetAgent: 'coding',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt, fileName },
            maxDepth: 2,
            dependsOn: infoGatheringTaskIds.length > 0 ? infoGatheringTaskIds : []
        });
    }

    // Fallback: If no explicit keywords matched but multi-agent delegation was triggered
    if (tasks.length === 0) {
        tasks.push(
            {
                taskId: `task_res_${Date.now()}_1`,
                parentId: rootId,
                targetAgent: 'research',
                taskDescription: `Research key details for: ${userPrompt}`,
                contextPayload: { originalPrompt: userPrompt },
                maxDepth: 2,
                dependsOn: []
            },
            {
                taskId: `task_code_${Date.now()}_2`,
                parentId: rootId,
                targetAgent: 'coding',
                taskDescription: `Implement code or structured solution for: ${userPrompt}`,
                contextPayload: { originalPrompt: userPrompt },
                maxDepth: 2,
                dependsOn: [`task_res_${Date.now()}_1`]
            }
        );
    }

    return tasks;
}

