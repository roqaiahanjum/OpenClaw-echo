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
export async function generatePlan(input: string, availableTools: string[]): Promise<ExecutionPlan | null> {
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

        const response = await router.invoke(messages, "planner");
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
        console.warn("[Planner] Plan generation skipped:", error.message);
        return null;
    }
}

/**
 * Smart Planner Wrapper (Phase 4B)
 * Uses evaluatePlanComplexity to bypass LLM planning on simple prompts or fallback mode.
 */
export async function generateSmartPlan(input: string, availableTools: string[]): Promise<ExecutionPlan | null> {
    const router = ModelRouter.getInstance();
    if (router.isInFallbackMode()) {
        console.log(`[PlannerGuard] BYPASSED LLM — Router in Fallback Mode (Saved 1 Gemini API Call)`);
        const check = evaluatePlanComplexity(input, availableTools);
        return check.localPlan || { goal: input, steps: [{ stepNumber: 1, description: "Direct execution", suggestedTool: undefined }] };
    }

    const check = evaluatePlanComplexity(input, availableTools);
    if (!check.isComplex && check.localPlan) {
        console.log(`[PlannerGuard] BYPASSED LLM — ${check.reason} (Saved 1 Gemini API Call)`);
        return check.localPlan;
    }
    console.log(`[PlannerGuard] COMPLEX — ${check.reason}. Invoking Gemini LLM planner...`);
    return await generatePlan(input, availableTools);
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

    const needsResearch = lower.includes("research") || lower.includes("find") || lower.includes("search") || lower.includes("history") || lower.includes("turing");
    const needsCoding = lower.includes("code") || lower.includes("script") || lower.includes("write a") || lower.includes("function") || lower.includes("typescript") || lower.includes("javascript");
    const needsBrowser = lower.includes("url") || lower.includes("http") || lower.includes("web page") || lower.includes("fetch page") || lower.includes("browse");

    if (needsResearch) {
        tasks.push({
            taskId: `task_res_${Date.now()}_1`,
            parentId: rootId,
            targetAgent: 'research',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt },
            maxDepth: 2
        });
    }

    if (needsCoding) {
        tasks.push({
            taskId: `task_code_${Date.now()}_2`,
            parentId: rootId,
            targetAgent: 'coding',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt },
            maxDepth: 2
        });
    }

    if (needsBrowser) {
        tasks.push({
            taskId: `task_brow_${Date.now()}_3`,
            parentId: rootId,
            targetAgent: 'browser',
            taskDescription: userPrompt,
            contextPayload: { originalPrompt: userPrompt },
            maxDepth: 2
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
                maxDepth: 2
            },
            {
                taskId: `task_code_${Date.now()}_2`,
                parentId: rootId,
                targetAgent: 'coding',
                taskDescription: `Implement code or structured solution for: ${userPrompt}`,
                contextPayload: { originalPrompt: userPrompt },
                maxDepth: 2
            }
        );
    }

    return tasks;
}

