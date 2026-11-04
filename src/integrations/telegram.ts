import express, { Request, Response } from "express";
import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { ModelRouter } from "../core/router";
import { MemoryManager } from "../memory/manager";
import { SkillRegistry } from "../skills/registry";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs/promises";
import { DashboardLogger } from "../core/logger";
import { PERSONALITIES, PersonalityMode } from "../core/personalities";
import { Telemetry } from "../core/telemetry";
import { ProjectAnalyzer } from "../core/analyzer";
import { Clockwork } from "../core/clockwork";
import { generateSmartPlan, formatPlanForPrompt, decomposeIntoACPTasks } from "../core/planner";
import { SubAgentManager } from "../agents/SubAgentManager";
import { ACPTask } from "../agents/types";
import { verifyStepResult } from "../core/verifier";
import { determineRecoveryStrategy } from "../core/recovery";
import { localVerifyToolResult } from "../core/localVerifier";
import { validateResponseHonesty } from "../core/toolHonestyGuard";
import { isSimpleConversation } from "../core/conversationGuard";
import { ToolSelector } from "../core/toolSelector";
import { AuthManager } from "../core/auth";
import { classifyUserIntent, classifyUserIntentAsync } from "../core/intentClassifier";
import { WebhookTracker } from "./webhookTracker";
import { telemetry } from "./telemetry";

console.log(`[PID:${process.pid}] Bot initialization`);
let updateCounter = 0;
let currentCorrId = '';
function generateCorrId(updateId: any): string {
    updateCounter++;
    return `${updateId}-${updateCounter}`;
}


dotenv.config();
import dns from 'dns';
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

export function sanitizeTelegramError(err: any): string {
    const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
    let msg = "";
    if (typeof err === "string") {
        msg = err;
    } else if (err?.stack) {
        msg = err.stack;
    } else if (err?.message) {
        msg = err.message;
    } else {
        msg = String(err);
    }
    if (token) {
        msg = msg.split(token).join("[REDACTED_BOT_TOKEN]");
    }
    // Mask bot tokens inside Telegram API URLs (e.g. /bot<TOKEN>/...)
    msg = msg.replace(/\/bot[a-zA-Z0-9_:-]+/g, "/bot[REDACTED_BOT_TOKEN]");
    return msg;
}

const bot = new Telegraf(process.env.TELEGRAM_TOKEN || "");

bot.catch((err: any, ctx: Context) => {
    console.error(`[Telegram] Bot error caught by handler for update ${ctx?.update?.update_id}:`, sanitizeTelegramError(err));
});

const router = ModelRouter.getInstance();
const memory = MemoryManager.getInstance();
const authManager = AuthManager.getInstance();
const app = express();
app.use(express.json());
app.use(express.static(path.resolve("public")));

const dashboardPath = path.resolve("dashboard/dist");
app.use(express.static(dashboardPath));

const PORT = parseInt(process.env.PORT || "3005");
const WEBHOOK_PATH = "/api/webhook";

let activePersonality: PersonalityMode = "standard";
let isBotRunning = false;
let isStopping = false;

/**
 * Splits text into chunks of at most `maxLen` characters (Telegram hard limit is 4096),
 * preserving Markdown code fences (```lang ... ```) across split boundaries so each
 * chunk remains valid syntax for Telegram's Markdown parser.
 */
export function splitTelegramMessage(text: string, maxLen: number = 3800): string[] {
    if (!text || text.length <= maxLen) {
        return [text || ""];
    }

    const lines = text.split('\n');
    const chunks: string[] = [];
    let currentChunk = '';
    let inCodeBlock = false;
    let codeBlockLang = '';

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];

        // Break up single lines that alone exceed maxLen
        const subLines: string[] = [];
        if (rawLine.length > maxLen) {
            for (let offset = 0; offset < rawLine.length; offset += (maxLen - 100)) {
                subLines.push(rawLine.slice(offset, offset + (maxLen - 100)));
            }
        } else {
            subLines.push(rawLine);
        }

        for (const line of subLines) {
            // Check if this line opens or closes a code fence
            const fenceMatch = line.match(/^```(\w*)/);
            const isFenceLine = fenceMatch !== null;

            // Extra buffer needed if we have to close an open code block when splitting
            const closeFenceBuffer = inCodeBlock ? 5 : 0; // "\n```"
            const nextLen = currentChunk.length + (currentChunk ? 1 : 0) + line.length + closeFenceBuffer;

            if (nextLen > maxLen && currentChunk.length > 0) {
                if (inCodeBlock) {
                    chunks.push(currentChunk + '\n```');
                    currentChunk = '```' + codeBlockLang + '\n' + line;
                } else {
                    chunks.push(currentChunk);
                    currentChunk = line;
                }
            } else {
                currentChunk += (currentChunk ? '\n' : '') + line;
            }

            if (isFenceLine) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeBlockLang = fenceMatch[1] || '';
                } else {
                    inCodeBlock = false;
                    codeBlockLang = '';
                }
            }
        }
    }

    if (currentChunk.trim().length > 0) {
        if (inCodeBlock && !currentChunk.endsWith('```')) {
            currentChunk += '\n```';
        }
        chunks.push(currentChunk);
    }

    return chunks;
}

export async function safeSend(ctx: any, text: string, options: any = {}) {
    console.log(`[PID:${process.pid}] [${currentCorrId}] safeSend start length=${text.length}`);
    const chunks = splitTelegramMessage(text, 3800);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
            console.log(`[PID:${process.pid}] [${currentCorrId}] ctx.reply (chunk ${i+1}/${chunks.length})`);
            await ctx.reply(chunk, { parse_mode: 'Markdown', ...options });
        } catch (err: any) {
            console.warn(`[PID:${process.pid}] [${currentCorrId}] Markdown send failed for chunk ${i + 1}/${chunks.length}: ${err?.message}. Retrying plain text.`);
            try {
                console.log(`[PID:${process.pid}] [${currentCorrId}] ctx.reply plain fallback (chunk ${i+1})`);
                await ctx.reply(chunk, options);
            } catch (retryErr: any) {
                console.error(`[PID:${process.pid}] [${currentCorrId}] Plain text send failed for chunk ${i + 1}/${chunks.length}: ${retryErr?.message}`);
                throw retryErr;
            }
        }
        if (chunks.length > 1 && i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 300)); // small delay between chunks
        }
    }
}

const invokeWithTimeout = async (messages: any[], mode?: string, options?: any, parentSignal?: AbortSignal, reqId?: string) => {
    const controller = new AbortController();
    const timeoutMs = 45000; // 45s LLM timeout
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error('LLM_TIMEOUT'));
        }, timeoutMs);
    });

    if (parentSignal) {
        if (parentSignal.aborted) {
            clearTimeout(timer!);
            throw new Error('FLOW_ABORTED');
        }
        parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const mergedOptions = { ...options, signal: controller.signal, reqId };
    const tStart = Date.now();

    try {
        if (reqId) console.log(`[PID:${process.pid}] [LLM] invokeWithTimeout start mode=${mode || "agent"} reqId=${reqId}`);
        const result = await Promise.race([
            ModelRouter.getInstance().invokeWithRetry(messages, mode, mergedOptions),
            timeoutPromise,
        ]);
        const latency = Date.now() - tStart;
        if (reqId) {
            console.log(`[StructuredLog] [RequestId:${reqId}] [Event:LLMInvoke] [Mode:${mode || "agent"}] [LatencyMs:${latency}] [Status:Success]`);
        }
        return result;
    } catch (err: any) {
        const latency = Date.now() - tStart;
        if (reqId) {
            console.warn(`[StructuredLog] [RequestId:${reqId}] [Event:LLMInvoke] [Mode:${mode || "agent"}] [LatencyMs:${latency}] [Status:Failed] [Error:${err.message}]`);
        }
        throw err;
    } finally {
        clearTimeout(timer!);
    }
};

/**
 * Sanitizes user-facing output by removing unparsed internal tool-call JSON blocks
 * unless the user explicitly requested raw JSON formatting.
 */
export function cleanUserFacingResponse(text: string, userPrompt: string): string {
    if (!text || typeof text !== "string") return "";

    const userWantsRawJson = /\b(return json|in json|raw json|output json|as json)\b/i.test(userPrompt);
    if (userWantsRawJson) {
        return text;
    }

    let cleaned = text;

    // Remove markdown code blocks containing internal tool-call JSON
    cleaned = cleaned.replace(/```(?:json)?\s*\{[\s\S]*?"(?:tool|tool_name|action|name)"\s*:\s*"?(?:scrape_website|browser|coding|research|write_sandbox_file|web_search|local_file_system|run_sandbox_code)"[\s\S]*?\}\s*```/gi, "");

    // Remove unfenced raw JSON objects containing internal tool-call JSON
    cleaned = cleaned.replace(/\{\s*"(?:tool|tool_name|action|name)"\s*:\s*"?(?:scrape_website|browser|coding|research|write_sandbox_file|web_search|local_file_system|run_sandbox_code)"[\s\S]*?\}/gi, "");

    // Remove excessive empty lines
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

    return cleaned || text;
}

export const executeAutonomousFlow = async (input: string, chatId?: string | number, isPhoto?: boolean, replyFn?: any, photoLink?: string, isRetry?: boolean, parentSignal?: AbortSignal, requestId?: string, progressFn?: (msg: string) => Promise<void>) => {
    let hasReplied = false;
    const safeReply = async (text: string) => {
        if (hasReplied || parentSignal?.aborted) {
            console.log(`[StructuredLog] [RequestId:${requestId || "N/A"}] [Event:LateOrDuplicateReplySuppressed] [Aborted:${!!parentSignal?.aborted}] [AlreadyReplied:${hasReplied}]`);
            return;
        }
        hasReplied = true;
        if (replyFn) {
            const sanitizedText = cleanUserFacingResponse(text, input);
            await replyFn(sanitizedText);
        }
    };

    try {
        const persona = PERSONALITIES[activePersonality];
        DashboardLogger.log(`[Persona] Active: ${persona.label}`);
        DashboardLogger.log(`[Flow] Step 1: Processing interaction for ${chatId}`);

        if (parentSignal?.aborted) {
            throw new Error("FLOW_ABORTED");
        }

        const tStart = Date.now();
        DashboardLogger.log(`[Flow] Step 2: Retrieving context across 4 memory layers...`);
        let context = "";
        const tMemStart = Date.now();
        try {
            context = await memory.getContext(input, chatId?.toString() || 'default', parentSignal);
        } catch (e: any) {
            context = "No previous context available.";
        }
        const tMemEnd = Date.now();
        DashboardLogger.log(`[Memory] Retrieval: ${tMemEnd - tMemStart}ms`);

        if (parentSignal?.aborted) {
            throw new Error("FLOW_ABORTED");
        }

        // ◄── STEP 3: INTENT CLASSIFICATION & MANDATORY AGENT ROUTING ──►
        const recentHistoryRows = await memory.getRecentTurns(chatId?.toString() || 'default', 5).catch(() => []);
        const recentDialogueTurns = recentHistoryRows.map(r => ({ user: r.user_msg, bot: r.agent_res }));
        const intentDecision = await classifyUserIntentAsync(input, recentDialogueTurns);
        DashboardLogger.log(`[IntentRouter] Intent: ${intentDecision.intent} -> Primary Agent: ${intentDecision.primaryAgent} (Confidence: ${Math.round(intentDecision.confidence * 100)}%)`);
        if (requestId) {
            console.log(`[StructuredLog] [RequestId:${requestId}] [Event:IntentClassified] [Intent:${intentDecision.intent}] [PrimaryAgent:${intentDecision.primaryAgent}] [Confidence:${intentDecision.confidence}]`);
        }

        // 1. MULTI-AGENT / PLANNER PIPELINE
        const userChatId = chatId ? String(chatId) : undefined;
        if (!isPhoto && (intentDecision.intent === "MULTI_AGENT" || intentDecision.primaryAgent === "planner")) {
            if (progressFn) await progressFn("🤖 _Planning & orchestrating multi-agent execution with dependency resolution..._").catch(() => {});
            const plannerTask: ACPTask = {
                taskId: `planner_${requestId || Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "planner",
                taskDescription: input,
                contextPayload: { originalPrompt: input, chatId: userChatId },
                maxDepth: 3,
                dependsOn: []
            };

            const plannerResult = await SubAgentManager.getInstance().delegateTask(plannerTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(planner) called reqId=${requestId}`);
            const finalResponse = plannerResult.resultData || `⚠️ [PlannerSubAgent Failed]: ${plannerResult.error || "Execution incomplete"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // 2. CODING PIPELINE (CodingSubAgent with mandatory sandbox write + execution)
        if (!isPhoto && intentDecision.primaryAgent === "coding") {
            if (progressFn) await progressFn("💻 _Generating code and executing in sandbox verification engine..._").catch(() => {});
            const fileMatch = input.match(/(?:named|called|file|into|save|create)\s+([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i) ||
                              input.match(/([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i);
            const fileName = fileMatch ? fileMatch[1] : undefined;

            const codingTask: ACPTask = {
                taskId: `task_code_${Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "coding",
                taskDescription: input,
                contextPayload: { originalPrompt: input, fileName, chatId: userChatId },
                maxDepth: 1,
                dependsOn: []
            };

            const result = await SubAgentManager.getInstance().delegateTask(codingTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(coding) called reqId=${requestId}`);
            const finalResponse = result.status === "SUCCESS"
                ? result.resultData
                : `⚠️ [CodingSubAgent Incomplete/Failed]: ${result.error || "Execution did not complete successfully"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // 3. RESEARCH PIPELINE (ResearchSubAgent with mandatory web_search + knowledge graph)
        if (!isPhoto && intentDecision.primaryAgent === "research") {
            if (progressFn) await progressFn("🔬 _Researching live intelligence and traversing knowledge graph..._").catch(() => {});
            const researchTask: ACPTask = {
                taskId: `task_res_${Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "research",
                taskDescription: input,
                contextPayload: { originalPrompt: input, chatId: userChatId },
                maxDepth: 1,
                dependsOn: []
            };

            const result = await SubAgentManager.getInstance().delegateTask(researchTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(research) called`);
            const finalResponse = result.status === "SUCCESS"
                ? result.resultData
                : `⚠️ [ResearchSubAgent Incomplete/Failed]: ${result.error || "Research could not be completed"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // 4. BROWSER PIPELINE (BrowserSubAgent with mandatory scrape_website tool)
        if (!isPhoto && intentDecision.primaryAgent === "browser") {
            if (progressFn) await progressFn("🌐 _Inspecting webpage and reading online documentation..._").catch(() => {});
            const browserTask: ACPTask = {
                taskId: `task_brow_${Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "browser",
                taskDescription: input,
                contextPayload: { originalPrompt: input, chatId: userChatId },
                maxDepth: 1,
                dependsOn: []
            };

            const result = await SubAgentManager.getInstance().delegateTask(browserTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(browser) called`);
            const finalResponse = result.status === "SUCCESS"
                ? result.resultData
                : `⚠️ [BrowserSubAgent Incomplete/Failed]: ${result.error || "Webpage could not be inspected"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // 5. MEMORY PIPELINE (MemorySubAgent with persistent SQLite / semantic search)
        if (!isPhoto && intentDecision.primaryAgent === "memory") {
            if (progressFn) await progressFn("🧠 _Executing persistent SQLite memory operation..._").catch(() => {});
            const memTask: ACPTask = {
                taskId: `task_mem_${Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "memory",
                taskDescription: input,
                contextPayload: { originalPrompt: input, chatId: userChatId || "default", context },
                maxDepth: 1,
                dependsOn: []
            };

            const result = await SubAgentManager.getInstance().delegateTask(memTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(memory) called`);
            const finalResponse = result.status === "SUCCESS"
                ? result.resultData
                : `⚠️ [MemorySubAgent Incomplete/Failed]: ${result.error || "Memory operation could not be completed"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // 6. CONVERSATION PIPELINE (ConversationSubAgent with mandatory get_conversation_context tool)
        // Strictly handles pure conversational greetings and persona inquiries.
        // General subsystem tools (e.g. email, goals, git, clockwork) proceed to autonomous execution.
        if (!isPhoto && intentDecision.intent === "CONVERSATION") {
            if (progressFn) await progressFn("💬 _Retrieving conversation context and local knowledge..._").catch(() => {});
            const convTask: ACPTask = {
                taskId: `task_conv_${Date.now()}`,
                parentId: `root_${Date.now()}`,
                targetAgent: "conversation",
                taskDescription: input,
                contextPayload: { originalPrompt: input, chatId: chatId?.toString() || "default", context },
                maxDepth: 1,
                dependsOn: []
            };

            const result = await SubAgentManager.getInstance().delegateTask(convTask);
            console.log(`[PID:${process.pid}] [${currentCorrId}] delegateTask(conversation) called`);
            const finalResponse = result.status === "SUCCESS"
                ? result.resultData
                : `⚠️ [ConversationSubAgent Incomplete/Failed]: ${result.error || "Unable to retrieve conversation context"}`;

            if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
            await safeReply(finalResponse);
            await memory.addInteraction(input, finalResponse, chatId?.toString() || "default")
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        DashboardLogger.log(`[Flow] Step 3: Invoking ModelRouter for general subsystem tool / multimodal query...`);

        const toolSelection = ToolSelector.selectTools(input);
        const tools = toolSelection.tools;
        const toolNames = tools.map((t: any) => t.name);
        DashboardLogger.log(`[ToolSelector] Category: ${toolSelection.category} | Tools: ${tools.length} (~${toolSelection.tokenEstimate} tokens) | ${toolSelection.reason}`);
        if (requestId) {
            console.log(`[StructuredLog] [RequestId:${requestId}] [ToolSelector:Category=${toolSelection.category}] [ToolsCount=${tools.length}] [TokenEstimate=${toolSelection.tokenEstimate}]`);
        }
        const plan = await generateSmartPlan(input, toolNames, parentSignal);
        let planText = "";
        if (plan) {
            planText = formatPlanForPrompt(plan);
        }

        let messageContent: any = input;
        if (isPhoto && photoLink) {
            messageContent = [
                { type: "text", text: input },
                { type: "image_url", image_url: { url: photoLink } }
            ];
        }

        let systemPromptText = `CRITICAL INSTRUCTIONS:
1. CAPABILITIES & TOOL USAGE:
   - You must NEVER claim you lack an ability that exists in your tool registry.
   - When asked to run or execute JavaScript, TypeScript, or code: You MUST run it to completion and report the stdout result. First call write_sandbox_file to save the code into the sandbox (e.g. 'run.js'), then in the next step you MUST call run_sandbox_code on that file to execute it and return the script output to the user. Do not stop after writing the file.
   - For goals, milestones, or objectives, you MUST call manage_project_goals (action: 'create' or 'add' to save, action: 'list' to read). Always list the exact titles of the recorded goals (e.g. "finish testing") from the database tool output. NEVER guess or answer from general memory.
   - For saved facts or knowledge, you MUST read from get_all_knowledge or search_memory. NEVER guess.
2. MEMORY CONTEXT:
   - Before using external tools for basic conversational queries, check your memory context above.
   - Never use local_file_system to answer questions about your own identity, project name, or user information — this information is already in your memory context.

You are OpenClaw Echo, a helpful AI assistant.
Be brief and direct. Max 2-3 sentences.
Context: ${context}`;
        if (planText) {
            systemPromptText += planText;
        }

        let messages: any[] = [
            new SystemMessage(systemPromptText),
            new HumanMessage({ content: messageContent })
        ];

        DashboardLogger.log(`[Flow] Step 4: Executing autonomous cycle...`);
        let finalResponse = "";
        let iterations = 0;
        const MAX_ITERATIONS = 8;
        let recoveryAttempts = 0;
        const MAX_RECOVERY_ATTEMPTS = 2;
        const executedToolCalls: Array<{ name: string; args: any; output: string }> = [];

        while (iterations < MAX_ITERATIONS) {
            if (parentSignal?.aborted) {
                throw new Error("FLOW_ABORTED");
            }
            const logic = isPhoto ? "image_analysis" : "complex";
            const response: any = await invokeWithTimeout(messages, "agent", { tools }, parentSignal, requestId);
            let tool_calls = (response as any).tool_calls || [];

            // ◄── INTERCEPT TEXT-BASED TOOL CALLS (Fallback for models generating JSON in content) ──►
            if (tool_calls.length === 0 && response?.content) {
                const textContent = String(response.content);
                const jsonMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || textContent.match(/(\{[\s\S]*?"(?:name|tool|action)"[\s\S]*?\})/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[1]);
                        const toolName = parsed.name || parsed.tool || parsed.action || parsed.function;
                        const toolArgs = parsed.arguments || parsed.args || parsed.parameters || parsed.input || parsed.action_input || {};
                        const validTool = SkillRegistry.getToolByName(toolName);
                        if (validTool) {
                            tool_calls = [{
                                id: `call_parsed_${Date.now()}`,
                                name: toolName,
                                args: typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs
                            }];
                            DashboardLogger.log(`[AutonomousCycle] Parsed text-based tool call for '${toolName}'. Executing registered tool...`);
                        }
                    } catch {
                        // Not a valid tool call JSON
                    }
                }
            }

            if (tool_calls.length > 0 && !isPhoto) {
                messages.push(response);
                for (const toolCall of tool_calls) {
                    if (parentSignal?.aborted) {
                        throw new Error("FLOW_ABORTED");
                    }
                    const tool = SkillRegistry.getToolByName(toolCall.name);
                    if (tool) {
                        DashboardLogger.log(`[Status] Executing ${toolCall.name}...`);
                        if (progressFn) await progressFn(`⚙️ _Executing tool ${toolCall.name}..._`).catch(() => {});
                        if (requestId) {
                            console.log(`[StructuredLog] [RequestId:${requestId}] [Event:ToolInvocation] [Tool:${toolCall.name}]`);
                        }
                        const toolStart = Date.now();
                        let output: string;
                        try {
                            output = String(await tool.invoke(toolCall.args));
                        } catch (toolErr: any) {
                            output = `Error executing tool '${toolCall.name}': ${toolErr.message || toolErr}`;
                            console.error(`[Tool Error] Failed to execute ${toolCall.name}:`, toolErr);
                        }
                        const toolDuration = Date.now() - toolStart;
                        executedToolCalls.push({ name: toolCall.name, args: toolCall.args, output: String(output) });
                        if (requestId) {
                            console.log(`[StructuredLog] [RequestId:${requestId}] [Event:ToolResult] [Tool:${toolCall.name}] [DurationMs:${toolDuration}]`);
                        }

                        // ◄── HYBRID VERIFIER (LOCAL + GEMINI FALLBACK) ──►
                        const localCheck = localVerifyToolResult(toolCall.name, toolCall.args, String(output));
                        let verification: { success: boolean; reason: string };

                        if (localCheck.status === "pass") {
                            DashboardLogger.log(`[LocalVerifier] PASS — ${localCheck.reason}`);
                            verification = { success: true, reason: localCheck.reason };
                        } else if (localCheck.status === "fail") {
                            DashboardLogger.log(`[LocalVerifier] FAIL — ${localCheck.reason}`);
                            verification = { success: false, reason: localCheck.reason };
                        } else {
                            DashboardLogger.log(`[LocalVerifier] UNCERTAIN — ${localCheck.reason}. Falling back to Gemini verifier.`);
                            verification = await verifyStepResult(input, toolCall.name, String(output));
                        }

                        let finalOutput = String(output);
                        if (!verification.success) {
                            console.warn(`[Verifier] Step failed verification: ${verification.reason}`);

                            if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
                                console.warn('[Recovery] Max recovery attempts reached — breaking loop.');
                                finalOutput += `\n\n[RECOVERY SKIPPED: Max recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached.]`;
                            } else {
                                recoveryAttempts++;

                                // ◄── SELF-HEALING RECOVERY LAYER ──►
                                const availableToolNames = tools.map((t: any) => t.name);
                                const recovery = await determineRecoveryStrategy({
                                    userGoal: input,
                                    toolName: toolCall.name,
                                    toolArgs: toolCall.args,
                                    output: String(output),
                                    failureReason: verification.reason,
                                    availableTools: availableToolNames,
                                    attemptCount: recoveryAttempts
                                });

                                DashboardLogger.log(`[Recovery] Strategy selected: ${recovery.strategy} (${recovery.reason})`);

                                if ((recovery.strategy === "modify_args" || recovery.strategy === "alternative_tool" || recovery.strategy === "retry_same")) {
                                    const targetToolName = recovery.newToolName || toolCall.name;
                                    const targetArgs = recovery.newArgs || toolCall.args;
                                    const recoveryTool = SkillRegistry.getToolByName(targetToolName);

                                    if (recoveryTool) {
                                        DashboardLogger.log(`[Recovery] Re-executing via ${targetToolName}...`);
                                        const recoveryOutput = await recoveryTool.invoke(targetArgs);

                                        const localRecCheck = localVerifyToolResult(targetToolName, targetArgs, String(recoveryOutput));
                                        let reVerification: { success: boolean; reason: string };

                                        if (localRecCheck.status === "pass") {
                                            DashboardLogger.log(`[LocalVerifier] PASS — ${localRecCheck.reason}`);
                                            reVerification = { success: true, reason: localRecCheck.reason };
                                        } else if (localRecCheck.status === "fail") {
                                            DashboardLogger.log(`[LocalVerifier] FAIL — ${localRecCheck.reason}`);
                                            reVerification = { success: false, reason: localRecCheck.reason };
                                        } else {
                                            reVerification = await verifyStepResult(input, targetToolName, String(recoveryOutput));
                                        }

                                        if (reVerification.success) {
                                            finalOutput = String(recoveryOutput);
                                            console.log(`[Recovery] ✅ Inline recovery succeeded!`);
                                        } else {
                                            finalOutput += `\n\n[RECOVERY ATTEMPTED: Tried ${targetToolName} via ${recovery.strategy}. Reason: ${reVerification.reason}]`;
                                        }
                                    }
                                } else {
                                    finalOutput += `\n\n[VERIFICATION NOTE: This result may not fully satisfy the goal. Reason: ${verification.reason}. Recovery recommendation: ${recovery.strategy} - ${recovery.reason}]`;
                                }
                            }
                        } else {
                            console.log(`[Verifier] Step passed verification.`);
                        }
                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id,
                            content: finalOutput
                        }));
                    }
                }
                iterations++;
            } else {
                finalResponse = response.content as string;
                break;
            }
        }

        DashboardLogger.log(`[Flow] Step 5: Replying...`);
        // Guard: ensure we always send something even if the loop produced no content
        if (!finalResponse || finalResponse.trim() === "") {
            finalResponse = "I processed your request but wasn't able to generate a complete response. Please try rephrasing or breaking it into smaller steps.";
        }

        // ◄── TOOL RESULT HONESTY GUARD ──►
        // Enforces that success is never claimed if an action was requested but never executed or failed.
        const honestyCheck = validateResponseHonesty({
            userInput: input,
            executedToolCalls,
            llmResponse: finalResponse
        });
        if (!honestyCheck.honest) {
            console.warn(`[ToolHonestyGuard] Intercepted false success claim: ${honestyCheck.reason}`);
            finalResponse = honestyCheck.sanitizedResponse;
        }

        if (parentSignal?.aborted) throw new Error("FLOW_ABORTED");
        await safeReply(finalResponse);

        DashboardLogger.log(`[Flow] Step 6: Persisting interaction across 4 memory layers...`);
        await memory.addInteraction(input, finalResponse, chatId?.toString() || 'default')
            .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));

        Telemetry.broadcast("status_update", { event: "flow_complete" });

    } catch (error: any) {
        const msg = error.message || "";
        if (parentSignal?.aborted || msg.includes("FLOW_ABORTED") || msg.includes("Request aborted")) {
            console.log(`[StructuredLog] [RequestId:${requestId || "N/A"}] [Event:FlowCancelled] [Reason:AbortedOrTimedOut]`);
            return;
        }

        if (hasReplied) {
            console.log(`[StructuredLog] [RequestId:${requestId || "N/A"}] [Event:CatchErrorSuppressed] [Reason:ReplyAlreadySent]`);
            return;
        }

        console.error("[Fatal]", error.status || "N/A", error.message);
        DashboardLogger.log(`[Fatal] Flow Error Logic: ${error.message}`);

        const isRateLimit = msg.includes("429") || error.status === 429 || msg.toLowerCase().includes("too many requests");
        const isHardQuota = isRateLimit && (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("limit"));
        const isTimeout = msg.includes("503") || error.status === 503 || msg.toLowerCase().includes("timeout");

        if (isRateLimit && !isRetry && !isHardQuota && !parentSignal?.aborted) {
            DashboardLogger.log("[Status] Transient rate limit detected. Waiting 2s for retry...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (parentSignal?.aborted) return;
            return executeAutonomousFlow(input, chatId, isPhoto, safeReply, photoLink, true, parentSignal, requestId, progressFn);
        }

        let userFeedback = "⚠️ Service temporarily busy. Please try again in a few moments.";

        if (msg.includes("LLM_TIMEOUT") || msg.includes("timed out")) {
            userFeedback = "⏱️ Network model timed out while processing your request. Please try again or rephrase.";
        } else if (isHardQuota) {
            userFeedback = "⚠️ API Quota limit reached. Router operating in local context fallback mode.";
        } else if (isRateLimit) {
            userFeedback = "I'm thinking, please resend your message in a few seconds.";
        } else if (isTimeout) {
            userFeedback = "⏱️ Connection issue, please try again.";
        } else if (msg.includes("tokens")) {
            userFeedback = "⚠️ Message too long for my memory buffer.";
        } else if (msg.includes("GoogleGenerativeAI Error") || msg.includes("404") || msg.includes("500")) {
            userFeedback = "⚠️ Model service unavailable. Please retry your query.";
        }

        await safeReply(userFeedback);
    }
}


export function splitMessage(text: string, maxLength: number = 4000): string[] {
    const chunks: string[] = [];
    let current = text;
    while (current.length > 0) {
        if (current.length <= maxLength) {
            chunks.push(current);
            break;
        }
        let splitIndex = current.lastIndexOf("\n", maxLength);
        if (splitIndex <= 100) splitIndex = maxLength;
        chunks.push(current.substring(0, splitIndex).trim());
        current = current.substring(splitIndex).trim();
    }
    return chunks;
}

const chatExecutionQueues = new Map<string, Promise<void>>();

async function enqueueChatProcessing(chatId: string, fn: () => Promise<void>): Promise<void> {
    const prev = chatExecutionQueues.get(chatId) || Promise.resolve();
    const current = prev.then(fn, fn).finally(() => {
        if (chatExecutionQueues.get(chatId) === current) {
            chatExecutionQueues.delete(chatId);
        }
    });
    chatExecutionQueues.set(chatId, current);
    return current;
}

export async function processTelegramMessage(ctx: Context) {
    console.log(`[PID:${process.pid}] [${currentCorrId}] processTelegramMessage entry`);

    if (!ctx.message) return;

    const updateId = ctx.update?.update_id ?? "unknown";
    currentCorrId = generateCorrId(updateId);
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    console.log(`[DIAG:${requestId}] 1. Telegram update received (UpdateID: ${updateId})`);
    console.log(`[DIAG:${requestId}] 2. telegramHandler started`);

    const input = (ctx.message as any).text || (ctx.message as any).caption || "Analyze this image.";
    const isPhoto = !!(ctx.message as any).photo;
    let photoLink = undefined;
    console.log(`[DIAG:${requestId}] 3. user message extracted (Length: ${input.length}, IsPhoto: ${isPhoto})`);

    if (isPhoto) {
        const photo = (ctx.message as any).photo[(ctx.message as any).photo.length - 1];
        const link = await ctx.telegram.getFileLink(photo.file_id);
        try {
            const { default: axios } = await import("axios");
            const response = await axios.get(link.href, { responseType: 'arraybuffer' });
            const base64 = Buffer.from(response.data, 'binary').toString('base64');
            photoLink = `data:image/jpeg;base64,${base64}`;
        } catch (e) {
            photoLink = link.href;
        }
    }

    // 1. Strict Fast-Path Intent Classification
    const isGreeting = /^(hi|hello|hey|how are you|ping|test)[\s!.,?]*$/i.test(input.trim());
    if (isGreeting && !isPhoto) {
        console.log(`[DIAG:${requestId}] 8. final response generated (Greeting fast-path)`);
        console.log(`[DIAG:${requestId}] 9. ctx.reply/sendMessage started (Greeting)`);
        try {
            await ctx.reply("Hello! I am OpenClaw Echo. My tools and agents are online. How can I help you today?");
            console.log(`[DIAG:${requestId}] 10. Telegram response successfully sent (Greeting replied)`);
        } catch (greetingErr: any) {
            console.error(`[DIAG:${requestId}] Failed to reply to greeting:`, greetingErr.message);
        }
        return;
    }

    // Start typing indicator
    await ctx.sendChatAction('typing').catch(() => { });
    const typingInterval = setInterval(() => {
        ctx.sendChatAction('typing').catch(() => { });
    }, 4000);

    // 2. Send status message
    let statusMessageId: number | null = null;
    try {
        const statusMsg = await ctx.reply("⚙️ _Orchestrator is classifying intent and building a plan..._", { parse_mode: "Markdown" });
        statusMessageId = statusMsg.message_id;
    } catch (e) {
        console.error("Failed to send initial status message:", e);
    }

    const flowAbortController = new AbortController();
    let hasDispatchedFinalReply = false;
    console.log(`[StructuredLog] [RequestId:${requestId}] [Event:IncomingMessage] [ChatId:${ctx.chat?.id}]`);

    try {
        let isFirstReply = true;

        // Flow timeout — cancels background work at 90s
        const flowTimeout = new Promise<string>((resolve) =>
            setTimeout(() => resolve(
                "⏳ This task exceeded the 90-second execution window and was cancelled to preserve resources. For complex coding tasks, try breaking them into smaller steps."
            ), 90000)
        );

        const replyHandler = async (finalResponse: string) => {
            console.log(`[PID:${process.pid}] [${currentCorrId}] replyHandler called length=${finalResponse.length} hasDispatched=${hasDispatchedFinalReply}`);
            if (hasDispatchedFinalReply) {
                console.log(`[StructuredLog] [RequestId:${requestId}] [Event:DuplicateReplySuppressed]`);
                return;
            }
            hasDispatchedFinalReply = true;
            console.log(`[DIAG:${requestId}] 8. final response generated (Length: ${finalResponse.length})`);
            console.log(`[DIAG:${requestId}] 9. ctx.reply/sendMessage started (Target: ${statusMessageId ? "editMessageText" : "sendMessage"})`);
            let deliveryStatus = "failed";

            const MAX_CHUNK = 3800;
            const isTooLong = finalResponse.length > MAX_CHUNK;

            if (isFirstReply && statusMessageId !== null) {
                isFirstReply = false;
                if (isTooLong) {
                    // Response exceeds single message limit: edit progress message with short completion status,
                    // then deliver the response in ordered chunks.
                    const completionStatus = "✅ *Task Completed Successfully!*\n\n_Full response delivered in ordered parts below:_";
                    try {
                        await ctx.telegram.editMessageText(
                            ctx.chat?.id,
                            statusMessageId,
                            undefined,
                            completionStatus,
                            { parse_mode: "Markdown" }
                        );
                        deliveryStatus = "status_edited_with_short_completion";
                    } catch (editErr: any) {
                        const errMsg = editErr?.message || "";
                        if (!errMsg.includes("message is not modified")) {
                            console.warn(`[TelegramAPI] Markdown edit failed for status message: ${errMsg}. Retrying plain text.`);
                            try {
                                await ctx.telegram.editMessageText(
                                    ctx.chat?.id,
                                    statusMessageId,
                                    undefined,
                                    "✅ Task Completed Successfully!\n\nDelivering full response in ordered parts below:"
                                );
                                deliveryStatus = "status_edited_plain_fallback";
                            } catch (plainErr: any) {
                                console.error(`[TelegramAPI] Failed plain text edit of status message: ${plainErr?.message}`);
                            }
                        }
                    }

                    // Send the complete response in ordered chunks
                    await safeSend(ctx, finalResponse);
                    deliveryStatus += "_and_ordered_chunks_sent";
                } else {
                    // Response fits in single message: edit status message directly
                    try {
                        await ctx.telegram.editMessageText(
                            ctx.chat?.id,
                            statusMessageId,
                            undefined,
                            finalResponse,
                            { parse_mode: "Markdown" }
                        );
                        deliveryStatus = "edited_status_message";
                    } catch (err: any) {
                        const errMsg = err?.message || "";
                        if (errMsg.includes("message is not modified")) {
                            deliveryStatus = "unchanged";
                        } else {
                            console.warn(`[TelegramAPI] Markdown edit failed (${errMsg}). Retrying plain text.`);
                            try {
                                await ctx.telegram.editMessageText(
                                    ctx.chat?.id,
                                    statusMessageId,
                                    undefined,
                                    finalResponse
                                );
                                deliveryStatus = "edited_plain";
                            } catch (innerErr: any) {
                                console.error(`[TelegramAPI] Plain text edit failed: ${innerErr?.message}. Sending as new message.`);
                                await safeSend(ctx, finalResponse);
                                deliveryStatus = "fallback_sent";
                            }
                        }
                    }
                }
            } else {
                await safeSend(ctx, finalResponse);
                deliveryStatus = "new_message_sent";
            }

            console.log(`[StructuredLog] [RequestId:${requestId}] [TelegramDelivery:${deliveryStatus}]`);
            console.log(`[DIAG:${requestId}] 10. Telegram response successfully sent (Delivery: ${deliveryStatus})`);
        };

        const progressHandler = async (progressText: string) => {
            console.log(`[PID:${process.pid}] [${currentCorrId}] progressHandler called`);
            if (hasDispatchedFinalReply || flowAbortController.signal.aborted) return;
            if (statusMessageId !== null) {
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat?.id,
                        statusMessageId,
                        undefined,
                        progressText,
                        { parse_mode: "Markdown" }
                    );
                } catch {
                    // Suppress progress edit errors (e.g. text identical)
                }
            }
        };

        console.log(`[DIAG:${requestId}] 4. agent invocation started`);
        const callerId = ctx.chat?.id != null ? String(ctx.chat.id) : (ctx.from?.id != null ? String(ctx.from.id) : undefined);
        const flowPromise = executeAutonomousFlow(
            input,
            callerId,
            isPhoto,
            replyHandler,
            photoLink,
            false,
            flowAbortController.signal,
            requestId,
            progressHandler
        );

        // Race: flow vs 90s timeout
        const timeoutResult = await Promise.race([
            flowPromise.then(() => null).catch((err: any) => {
                console.error("[telegramHandler] flowPromise error:", err.message);
                return `⚠️ An error occurred processing your request: ${err.message}`;
            }),
            flowTimeout
        ]);

        if (timeoutResult !== null) {
            flowAbortController.abort();
            console.warn(`[StructuredLog] [RequestId:${requestId}] [TimeoutReason:${timeoutResult.includes("exceeded") ? "FlowTimeout90s" : "FlowError"}] [Action:Cancelled]`);
            await replyHandler(timeoutResult);
        } else if (!hasDispatchedFinalReply) {
            await replyHandler("⚠️ The requested operation completed, but did not return a final response. Please retry.");
        }
    } catch (handlerErr: any) {
        console.error(`[telegramHandler] Unhandled error during request ${requestId}:`, handlerErr?.message || handlerErr);
        try {
            await ctx.reply(`⚠️ An error occurred while processing your message: ${handlerErr?.message || "Unknown error"}`);
        } catch { }
    } finally {
        clearInterval(typingInterval);
    }
}

async function telegramHandler(ctx: Context) {
    if (!ctx.message) return;
    const updateId = (ctx.update as any)?.update_id ?? "unknown";
    const tmpCorrId = `${updateId}-${updateCounter + 1}`;
    console.log(`[PID:${process.pid}] [${tmpCorrId}] telegramHandler entry`);
    const callerId = ctx.chat?.id != null ? String(ctx.chat.id) : (ctx.from?.id != null ? String(ctx.from.id) : "default");
    return enqueueChatProcessing(callerId, async () => {
        await processTelegramMessage(ctx);
    });
}


// ◄── SECURE DEMO ACCESS-CODE AUTHENTICATION MIDDLEWARE ──►
bot.use(async (ctx: Context, next: () => Promise<void>) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId) {
        return next();
    }

    // If demo access authentication is not configured in server environment, pass through
    if (!authManager.isAuthEnabled()) {
        return next();
    }

    // Fail closed: If auth is configured but storage/cache is not yet initialized, block protected traffic
    if (!authManager.isReady()) {
        await ctx.reply("⚠️ *Authentication Service Temporarily Unavailable*\n\nThe database authorization store is currently reconnecting or uninitialized. Protected operations are suspended until persistent storage is restored.", { parse_mode: "Markdown" });
        return;
    }

    const isAuthorized = authManager.isUserAuthorized(userId);
    const messageText = (ctx.message as any)?.text?.trim();

    // ── CASE 1: AUTHORIZED USER OR ADMINISTRATOR ──
    if (isAuthorized) {
        // Admin-only user management commands
        if (messageText && authManager.isAdmin(userId)) {
            if (messageText.startsWith("/revoke")) {
                const parts = messageText.split(/\s+/);
                const targetId = parts[1]?.trim();
                if (!targetId) {
                    await ctx.reply("ℹ️ *Usage:* `/revoke <telegram_user_id>`", { parse_mode: "Markdown" });
                    return;
                }
                const revoked = await authManager.revokeUser(targetId);
                if (revoked) {
                    await ctx.reply(`✅ *User Revoked*\n\nUser ID \`${targetId}\` has been revoked and blocked from OpenClaw Echo.`, { parse_mode: "Markdown" });
                    console.log(`[AuthAdmin] Admin ${userId} revoked demo access for user ${targetId}.`);
                } else {
                    await ctx.reply(`⚠️ User ID \`${targetId}\` was not found among active authorized records.`, { parse_mode: "Markdown" });
                }
                return;
            }

            if (messageText === "/authusers" || messageText === "/listusers") {
                const users = await authManager.listAuthorizedUsers();
                if (users.length === 0) {
                    await ctx.reply("ℹ️ No active authorized demo users recorded.");
                    return;
                }
                const formatted = users.map(u => 
                    `• ID: \`${u.user_id}\` | @${u.username || "anonymous"} | Authorized: ${new Date(u.authorized_at).toLocaleString()}`
                ).join("\n");
                await ctx.reply(`👥 *Authorized Demo Users (${users.length}):*\n\n${formatted}`, { parse_mode: "Markdown" });
                return;
            }
        }

        // Proceed to existing command and autonomous agent message handlers
        return next();
    }

    // ── CASE 2: UNAUTHORIZED USER - /start WITHOUT CODE ──
    if (messageText === "/start") {
        await ctx.reply(
            "🔒 *OpenClaw Echo — Protected Demo Access*\n\n" +
            "Welcome! This autonomous multi-agent AI instance is running in **protected demo mode**.\n\n" +
            "To unlock AI conversations, multi-agent workflows, sandbox tools, and memory, please reply with your **Demo Access Code**.",
            { parse_mode: "Markdown" }
        );
        return;
    }

    // ── CASE 3: UNAUTHORIZED USER - SUBMITTING CANDIDATE ACCESS CODE ──
    if (messageText) {
        let candidateCode = "";
        if (messageText.startsWith("/start ")) {
            candidateCode = messageText.substring(7).trim();
        } else if (messageText.startsWith("/access ")) {
            candidateCode = messageText.substring(8).trim();
        } else if (messageText.startsWith("/code ")) {
            candidateCode = messageText.substring(6).trim();
        } else if (!messageText.startsWith("/")) {
            candidateCode = messageText;
        }

        if (candidateCode) {
            // Requirement 8: Delete code message where Telegram permissions allow to prevent exposure
            if (ctx.chat?.type === "private" && ctx.message?.message_id) {
                try {
                    await ctx.deleteMessage(ctx.message.message_id);
                } catch (_) {
                    // Silently ignore if bot lacks delete permissions
                }
            }

            const username = ctx.from?.username || ctx.from?.first_name || "Guest";
            const result = await authManager.verifyAndAuthorize(userId, candidateCode, {
                username: ctx.from?.username,
                firstName: ctx.from?.first_name
            });

            if (result.success) {
                console.log(`[Auth] User ${userId} (@${ctx.from?.username || "anon"}) successfully authenticated with access code.`);
                await ctx.reply(
                    `✅ *Access Granted!*\n\n` +
                    `Welcome to OpenClaw Echo, *${username}*!\n\n` +
                    `Your Telegram user ID (\`${userId}\`) has been authorized.\n\n` +
                    `*Available Capabilities:*\n` +
                    `• 🤖 Autonomous Multi-Agent Swarm (Research, Coding, Browser)\n` +
                    `• 🧠 4-Layer Memory (SQLite, Knowledge Graph, Semantic Core)\n` +
                    `• 🛠️ Code Execution Sandbox & AST Self-Repair\n` +
                    `• 🧹 Memory Controls (/clear, /memory, /facts)\n\n` +
                    `Type any prompt or request to begin!`,
                    { parse_mode: "Markdown" }
                );
                return;
            }

            if (result.error === "LOCKED_OUT") {
                const mins = Math.ceil((result.lockoutSec || 900) / 60);
                console.warn(`[Auth] User ${userId} is locked out. Remaining: ${result.lockoutSec}s.`);
                await ctx.reply(
                    `⏳ *Authentication Locked*\n\n` +
                    `Too many consecutive failed attempts. For security, access is temporarily locked.\n\n` +
                    `Please try again in *${mins} minute(s)*.`,
                    { parse_mode: "Markdown" }
                );
                return;
            }

            // Invalid code (Requirement 4 & 8: never log candidate code)
            console.warn(`[Auth] Failed demo access code attempt for user ${userId}. Remaining attempts: ${result.remainingAttempts}`);
            const remaining = result.remainingAttempts ?? 0;
            const attemptWarning = remaining > 0
                ? `⚠️ *${remaining} attempt(s) remaining* before a 15-minute lockout.`
                : `🚫 *You have been locked out for 15 minutes.*`;

            await ctx.reply(
                `❌ *Invalid Access Code*\n\n` +
                `The access code you entered is incorrect.\n\n` +
                `${attemptWarning}\n\n` +
                `Please verify the code provided by your demonstrator and try again.`,
                { parse_mode: "Markdown" }
            );
            return;
        }
    }

    // ── CASE 4: UNAUTHORIZED USER - BLOCKED FROM ALL OTHER COMMANDS/ACTIONS ──
    await ctx.reply(
        "⛔ *Unauthorized Access*\n\n" +
        "You must authenticate before using OpenClaw Echo.\n\n" +
        "Please send /start to enter your demo access code.",
        { parse_mode: "Markdown" }
    );
});

bot.command("start", (ctx) => ctx.reply("🚀 OpenClaw Echo is online and ready! Port: " + PORT));

bot.command("clear", async (ctx) => {
    try {
        await memory.clearHistory(String(ctx.chat?.id));
        await ctx.reply("🧹 Chat history cleared for this conversation! What's on your mind?");
        DashboardLogger.log(`[System] User requested history clear for ${ctx.chat?.id}.`);
    } catch (e) {
        await ctx.reply("❌ Error clearing memory.");
    }
});

bot.command("memory", async (ctx) => {
    try {
        const stats = await memory.getStats();
        await ctx.reply(
            `🧠 *Memory System Statistics*\n\n` +
            `• Interactions (Short-Term): ${stats.interactions}\n` +
            `• Knowledge Facts: ${stats.facts}\n` +
            `• Summaries: ${stats.summaries}\n` +
            `• Vector Embeddings: ${stats.vectors}`,
            { parse_mode: "Markdown" }
        );
    } catch (e: any) {
        await ctx.reply("❌ Error fetching memory stats.");
    }
});

bot.command("facts", async (ctx) => {
    try {
        const facts = await memory.getAllFacts(String(ctx.chat?.id));
        if (!facts || facts.length === 0) {
            await ctx.reply("ℹ️ No knowledge facts stored yet.");
            return;
        }

        const lines = facts
            .map(f => `• *${f.key}*: ${f.value} [${f.category}]`)
            .join("\n");

        const replyFn = async (text: string, title?: string) => {
            const fullText = title ? `${title}\n\n${text}` : text;
            try {
                await ctx.reply(fullText, { parse_mode: "Markdown" });
            } catch (err: any) {
                console.warn("[Facts Command] Markdown reply failed, falling back to plain text:", err.message);
                await ctx.reply(fullText);
            }
        };

        const MAX_LENGTH = 3800;
        if (lines.length <= MAX_LENGTH) {
            await replyFn(lines, `💡 *What I know (${facts.length} facts):*`);
        } else {
            await replyFn(`💡 *What I know (${facts.length} facts) — sending in parts:*`);
            
            let chunk = "";
            for (const line of lines.split("\n")) {
                if ((chunk + "\n" + line).length > MAX_LENGTH) {
                    await replyFn(chunk);
                    chunk = line;
                } else {
                    chunk += (chunk ? "\n" : "") + line;
                }
            }
            if (chunk) {
                await replyFn(chunk);
            }
        }
    } catch (error: any) {
        console.error("[Facts Command] Error:", error);
        await ctx.reply(`❌ Error fetching facts: ${error.message}`);
    }
});

bot.command("searchmemory", async (ctx) => {
    try {
        const text = (ctx.message as any).text || "";
        const query = text.replace("/searchmemory", "").trim();
        if (!query) {
            await ctx.reply("Usage: /searchmemory <query>");
            return;
        }
        const result = await memory.searchMemory(query, String(ctx.chat?.id));
        await ctx.reply(`🔍 *Memory Search Results for "${query}"*\n\n${result}`);
    } catch (e: any) {
        await ctx.reply("❌ Error searching memory.");
    }
});

bot.command("clearall", async (ctx) => {
    try {
        await memory.clearAllMemory();
        await ctx.reply("🧹 All memory layers (SQLite interactions, Knowledge facts, Summaries, and Vector embeddings) have been completely wiped.");
        DashboardLogger.log(`[System] User executed /clearall.`);
    } catch (e: any) {
        await ctx.reply("❌ Error performing clearall.");
    }
});

bot.on(message("text"), telegramHandler);
bot.on(message("photo"), telegramHandler);

app.get("/", async (req: Request, res: Response) => {
    try {
        const reactDashboard = path.join(dashboardPath, "index.html");
        try {
            await fs.access(reactDashboard);
            return res.sendFile(reactDashboard);
        } catch (_) {
            const publicDashboardPath = path.resolve("public/dashboard.html");
            return res.sendFile(publicDashboardPath);
        }
    } catch (err) {
        res.status(500).send("OpenClaw Echo: Dashboard Error.");
    }
});

app.get("/telemetry", async (req: Request, res: Response) => {
    try {
        const publicDashboardPath = path.resolve("public/dashboard.html");
        res.sendFile(publicDashboardPath);
    } catch (err) {
        res.status(500).send("OpenClaw Echo: Telemetry Dashboard Error.");
    }
});

app.get("/api/telemetry/stream", (req: Request, res: Response) => {
    telemetry.handleSSEStream(req, res);
});

app.get("/api/stats", async (req: Request, res: Response) => {
    try {
        const memStats = await memory.getStats();
        const execStats = telemetry.getExecutionStats();
        const routerHealth = await router.checkHealth();
        res.json({
            memory: memStats,
            execution: execStats,
            router: routerHealth
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

app.get("/api/status", async (req: Request, res: Response) => {
    try {
        const routerHealth = await router.checkHealth();
        const memoryHealth = await memory.checkHealth();
        res.json({
            mode: process.env.TELEGRAM_MODE || "polling",
            router: routerHealth,
            memory: memoryHealth,
            skills: SkillRegistry.getTools().length,
            personality: PERSONALITIES[activePersonality].label
        });
    } catch (err) {
        res.status(500).json({ error: "Fail" });
    }
});

app.get("/api/personality", (req: Request, res: Response) => {
    res.json({
        current: activePersonality,
        available: Object.keys(PERSONALITIES).map(key => ({
            id: key,
            label: PERSONALITIES[key].label,
            color: PERSONALITIES[key].color
        }))
    });
});

app.post("/api/personality", (req: Request, res: Response) => {
    const { mode } = req.body;
    if (PERSONALITIES[mode]) {
        activePersonality = mode as PersonalityMode;
        DashboardLogger.log(`[System] Identity shifted to: ${PERSONALITIES[mode].label}`);
        res.json({ status: "success", mode });
    } else {
        res.status(400).json({ error: "Invalid persona mode" });
    }
});

app.get("/api/logs", (req: Request, res: Response) => {
    res.json(DashboardLogger.getLogs());
});

app.post("/api/chat", async (req: Request, res: Response) => {
    const { message: userMsg } = req.body;
    if (!userMsg) return res.status(400).json({ error: "Missing message" });

    DashboardLogger.log(`[WebChat] Inbound from dashboard user.`);

    let agentResponse = "";

    try {
        await executeAutonomousFlow(
            userMsg,
            "WEB_INTERFACE",
            false,
            async (content) => {
                agentResponse = content;
                DashboardLogger.log(`[WebChat Outbound] ${content}`);
            }
        );
        res.json({ response: agentResponse });
    } catch (err: any) {
        res.status(500).json({ error: err.message || "Internal Server Error" });
    }
});

app.get("/api/sandbox", async (req: Request, res: Response) => {
    try {
        const sandboxDir = path.resolve("src/sandbox");
        const files = await fs.readdir(sandboxDir);
        res.json({ files });
    } catch (err) {
        res.json({ files: [] });
    }
});

app.get("/api/sandbox/raw", async (req: Request, res: Response) => {
    try {
        const fileName = req.query.file as string;
        if (!fileName) return res.status(400).send("No file specified");
        const filePath = path.join(path.resolve("src/sandbox"), fileName);
        if (!filePath.startsWith(path.resolve("src/sandbox"))) {
            return res.status(403).send("Forbidden");
        }
        res.sendFile(filePath);
    } catch (err) {
        res.status(404).send("Not found");
    }
});

app.get("/api/knowledge", async (req: Request, res: Response) => {
    try {
        const corePath = path.join(__dirname, "../memory/semantic_core.json");
        const data = await fs.readFile(corePath, "utf-8");
        const vectors = JSON.parse(data);
        const knowledgeItems = vectors
            .filter((v: any) => v.metadata?.isKnowledge)
            .map((v: any) => ({
                source: v.metadata.source,
                timestamp: v.metadata.timestamp,
                id: v.metadata.id
            }));
        const unique = Array.from(new Set(knowledgeItems.map((k: any) => k.source)));
        res.json({ count: knowledgeItems.length, sources: unique });
    } catch (err) {
        res.json({ count: 0, sources: [] });
    }
});

app.get("/api/audit", async (req: Request, res: Response) => {
    try {
        const report = await ProjectAnalyzer.performFullSystemAudit();
        res.json(report);
    } catch (err) {
        res.status(500).json({ summary: "Audit Failed", score: 0 });
    }
});

app.post("/api/maintenance", async (req: Request, res: Response) => {
    try {
        DashboardLogger.log("[System] Deep maintenance cycle triggered via dashboard.");
        await (memory as any).optimize();
        const sandboxDir = path.resolve("src/sandbox");
        const files = await fs.readdir(sandboxDir);
        for (const file of files) {
            if (file.endsWith(".txt") || file.endsWith(".md")) {
                const content = await fs.readFile(path.join(sandboxDir, file), "utf-8");
                await memory.ingestDocument(content, file);
                DashboardLogger.log(`[Scholar] Refreshed knowledge from ${file}`);
            }
        }
        res.json({ status: "success" });
    } catch (err: any) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

import { GoalManager } from "../core/goals";
const globalOracle = new GoalManager();

app.get("/api/goals", async (req: Request, res: Response) => {
    try {
        const goals = await globalOracle.getActiveGoals();
        res.json(goals);
    } catch (err) {
        res.json([]);
    }
});

app.get("/api/schedules", async (req: Request, res: Response) => {
    try {
        const tasks = await Clockwork.listTasks();
        res.json({ tasks });
    } catch (e) { res.json({ tasks: [] }); }
});

app.post("/api/schedules", async (req: Request, res: Response) => {
    try {
        const { name, description, intervalMs, prompt } = req.body;
        if (!name || !intervalMs || !prompt) {
            return res.status(400).json({ error: "name, intervalMs, and prompt are required" });
        }
        const task = await Clockwork.createTask(name, description || "", intervalMs, prompt);
        res.json({ task });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/schedules/:id/toggle", async (req: Request, res: Response) => {
    try {
        const { enabled } = req.body;
        const task = await Clockwork.toggleTask(req.params.id, enabled);
        res.json({ task });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete("/api/schedules/:id", async (req: Request, res: Response) => {
    try {
        const deleted = await Clockwork.deleteTask(req.params.id);
        res.json({ success: deleted });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/test-drive", async (req: Request, res: Response) => {
    DashboardLogger.log("[TestDrive] Initiating autonomous simulation...");
    const simulatedChallenge = "Research the historical significance of Turing machines and save a brief note to sandbox as 'history.txt'";
    executeAutonomousFlow(
        simulatedChallenge,
        "VIRTUAL_DASHBOARD",
        false,
        async (content) => { DashboardLogger.log(`[TestDrive Response] ${content}`); }
    );
    res.json({ status: "initiated", challenge: simulatedChallenge });
});

const webhookTracker = WebhookTracker.getInstance();

app.post(WEBHOOK_PATH, async (req: Request, res: Response) => {
    const updateId = req.body?.update_id;
    const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id || "default";

    if (updateId != null) {
        // Durably register update in database (Turso / SQLite) before proceeding
        const registration = await webhookTracker.registerIncomingUpdate(updateId, String(chatId), req.body);
        if (registration.action === "SKIP") {
            return res.status(200).send(`OK (${registration.reason})`);
        }
        if (registration.action === "ERROR") {
            console.error(`[TelegramWebhook] Durable registration failed for update ${updateId}: ${registration.error}. Returning HTTP 500 for Telegram retry.`);
            return res.status(500).send("Update persistence failed; requesting retry");
        }
    }

    // Process update with timeout race to protect Telegram webhook SLA
    const processPromise = (async () => {
        try {
            await bot.handleUpdate(req.body);
            if (updateId != null) {
                await webhookTracker.markCompleted(updateId);
            }
        } catch (err: any) {
            console.error(`[TelegramWebhook] Asynchronous error processing update ${updateId}:`, sanitizeTelegramError(err));
            if (updateId != null) {
                await webhookTracker.markFailed(updateId, sanitizeTelegramError(err));
            }
        }
    })();

    // Acknowledge within 3500ms or when processing completes
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3500));
    await Promise.race([processPromise, timeoutPromise]);

    if (!res.headersSent) {
        res.status(200).send("OK");
    }
});

app.use((err: any, req: Request, res: Response, next: any) => {
    console.error("[Server Error]", sanitizeTelegramError(err));
    res.status(500).json({ error: "Internal Server Error", details: sanitizeTelegramError(err) });
});

app.get("/healthz", (req: Request, res: Response) => {
    res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
});

app.get("/readyz", async (req: Request, res: Response) => {
    try {
        const memoryOk = await memory.checkHealth().then(h => h.sqlite.status === "connected").catch(() => false);
        const routerOk = await router.checkHealth().then(h => (h.gemini?.status === "connected" || h.gemini?.status === "healthy") || (h.groq?.status === "connected" || h.groq?.status === "healthy")).catch(() => false);
        const authOk = !authManager.isAuthEnabled() || authManager.isReady();

        const isFullyReady = memoryOk && routerOk && authOk;

        if (isFullyReady) {
            res.status(200).json({
                status: "ready",
                database: "connected",
                router: "connected",
                auth: authManager.isAuthEnabled() ? "ready" : "disabled",
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({
                status: "not_ready",
                database: memoryOk ? "connected" : "disconnected",
                router: routerOk ? "connected" : "degraded",
                auth: authManager.isAuthEnabled() ? (authOk ? "ready" : "uninitialized") : "disabled",
                timestamp: new Date().toISOString()
            });
        }
    } catch (e: any) {
        res.status(503).json({ status: "error", error: e.message });
    }
});

app.get("/health", (req: Request, res: Response) => {
    res.status(200).send("OK");
});

app.get("/api/status", (req: Request, res: Response) => {
    res.status(200).json({ status: "online", bot: isBotRunning ? "polling" : "idle", uptime: Math.floor(process.uptime()) });
});

app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(dashboardPath, "index.html"), (err) => {
        if (err) res.status(404).send("Dashboard not built.");
    });
});


export const startServer = async (initialPort?: number) => {
    if (!process.env.TELEGRAM_TOKEN) {
        console.error("[Fatal] TELEGRAM_TOKEN missing.");
        process.exit(1);
    }

    // Initialize Auth Persistence & Preload Active Users Cache
    try {
        await authManager.init();
    } catch (err: any) {
        console.error(`[Auth] Warning: AuthManager schema initialization failed: ${err.message}. Continuing with in-memory auth cache.`);
    }

    const mode = (process.env.TELEGRAM_MODE || "polling").toLowerCase();
    const basePort = initialPort || parseInt(process.env.PORT || "3005");
    const isProduction = process.env.NODE_ENV === "production" || !!process.env.RENDER;
    const MAX_ATTEMPTS = isProduction ? 1 : 10;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const currentPort = basePort + attempt;
        try {
            const server = await new Promise((resolve, reject) => {
                const s = app.listen(currentPort, "0.0.0.0", () => resolve(s));
                s.on("error", (err: any) => reject(err));
            });

            DashboardLogger.log(`🚀 OPENCLAW ECHO: ${mode.toUpperCase()} MODE ACTIVATED on Port ${currentPort}`);

            // Start Clockwork Scheduler
            Clockwork.setExecutor(async (prompt: string) => {
                await executeAutonomousFlow(
                    prompt, "CLOCKWORK_SCHEDULER", false,
                    async (content) => { DashboardLogger.log(`[Clockwork] Result: ${content.slice(0, 200)}`); }
                );
            });
            await Clockwork.boot();

            // Pre-fetch bot identity to avoid lazy getMe network races during updates
            try {
                const me = await bot.telegram.getMe();
                bot.botInfo = me;
                DashboardLogger.log(`🤖 Bot identity verified: @${me.username} (${me.id})`);
            } catch (e: any) {
                console.warn('[Telegram] Non-fatal getMe prefetch warning:', sanitizeTelegramError(e));
            }

            // Connect Telegram
            if (mode === "disabled" || mode === "off" || mode === "none") {
                DashboardLogger.log("ℹ️ Telegram integration disabled via TELEGRAM_MODE=disabled.");
            } else if (mode === "webhook") {
                const webhookUrlBase = process.env.TELEGRAM_WEBHOOK_URL || (process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : ""));
                if (!webhookUrlBase) {
                    console.error("[Telegram] TELEGRAM_WEBHOOK_URL missing for webhook mode.");
                } else if (!webhookUrlBase.startsWith("https://")) {
                    console.error(`[Telegram] Invalid webhook URL: must start with https://, got: ${webhookUrlBase}`);
                } else {
                    const fullWebhookUrl = `${webhookUrlBase.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
                    const MAX_WEBHOOK_RETRIES = 5;
                    let webhookRegistered = false;

                    for (let attempt = 1; attempt <= MAX_WEBHOOK_RETRIES; attempt++) {
                        try {
                            await bot.telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: false });
                            webhookRegistered = true;
                            DashboardLogger.log(`✅ Webhook registered: ${fullWebhookUrl}`);
                            // Run durable recovery sweep in background for any updates left incomplete before crash/restart
                            webhookTracker.recoverPendingUpdates(bot).catch(e => {
                                console.warn("[Telegram] Webhook recovery sweep error:", sanitizeTelegramError(e));
                            });
                            break;
                        } catch (err: any) {
                            const sanitized = sanitizeTelegramError(err);
                            const errorCode = err?.response?.error_code || err?.code || err?.statusCode;
                            const msg = String(err?.message || "");
                            const isTerminal = 
                                errorCode === 401 || errorCode === 403 || errorCode === 404 || errorCode === 400 ||
                                msg.includes("401") || msg.includes("Unauthorized") ||
                                msg.includes("403") || msg.includes("Forbidden") ||
                                msg.includes("404") || msg.includes("Not Found") ||
                                msg.includes("400") || msg.includes("Bad Request");

                            if (isTerminal) {
                                console.error(`[Telegram] Permanent webhook registration error (${errorCode || 'terminal'}): ${sanitized}. Aborting registration.`);
                                break;
                            }

                            console.warn(`[Telegram] Webhook setup attempt ${attempt}/${MAX_WEBHOOK_RETRIES} failed: ${sanitized}`);
                            if (attempt < MAX_WEBHOOK_RETRIES) {
                                const backoffMs = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
                                await new Promise(r => setTimeout(r, backoffMs));
                            } else {
                                console.error(`[Telegram] Webhook setup permanently failed after ${MAX_WEBHOOK_RETRIES} attempts: ${sanitized}`);
                            }
                        }
                    }
                }
            } else {
                if (isBotRunning) {
                    DashboardLogger.log("ℹ️ Bot polling already active — skipping duplicate launch.");
                } else {
                    const startPollingWithRetry = async (retryCount = 0) => {
                        if (isStopping) return;
                        try {
                            // Delete any lingering webhook to prevent 409 Conflict with getUpdates
                            await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
                            
                            isBotRunning = true;
                            // Launch polling in background
                            await bot.launch({
                                dropPendingUpdates: false,
                                allowedUpdates: ["message", "edited_message", "callback_query"]
                            });
                            DashboardLogger.log("✅ Polling active.");
                        } catch (err: any) {
                            isBotRunning = false;
                            const isConflict = err.message?.includes("409") || err.message?.includes("Conflict");
                            if (isConflict) {
                                const waitMs = Math.min(30000, 3000 * Math.pow(1.5, retryCount));
                                console.warn(`[Telegram] ⚠️ 409 Conflict detected (another bot instance is running). Retrying in ${Math.round(waitMs)}ms (attempt ${retryCount + 1})...`);
                                if (!isStopping) {
                                    setTimeout(() => startPollingWithRetry(retryCount + 1), waitMs);
                                }
                            } else {
                                console.error("[Telegram] Polling error / Init failure:", sanitizeTelegramError(err));
                            }
                        }
                    };

                    startPollingWithRetry();
                }
            }

            return server;
        } catch (err: any) {
            if (err.code === "EADDRINUSE" && attempt < MAX_ATTEMPTS - 1) {
                console.warn(`[CleanPort] Port ${currentPort} in use (EADDRINUSE). Retrying on port ${currentPort + 1}...`);
            } else {
                throw err;
            }
        }
    }
};

export const stopServer = async (server: any, signal: string = "SIGTERM") => {
    if (isStopping) return;
    isStopping = true;
    try {
        console.log(`[Telegram] Initiating graceful shutdown (signal: ${signal})...`);
        if (bot && typeof bot.stop === "function" && isBotRunning) {
            try {
                console.log("[Telegram] Stopping polling consumer...");
                bot.stop(signal);
                isBotRunning = false;
                console.log("[Telegram] Polling consumer stopped cleanly.");
            } catch (e: any) {
                console.warn("[Telegram] Warning stopping bot:", e.message);
            }
        }
        if (server && server.close) {
            try {
                await new Promise((resolve) => server.close(resolve));
                console.log("[System] HTTP server closed.");
            } catch (e: any) {
                console.warn("[System] Warning closing HTTP server:", e.message);
            }
        }
        try {
            Clockwork.stop();
        } catch (e) { }
        try {
            await authManager.close();
            console.log("[Auth] Database connection closed.");
        } catch (e: any) {
            console.warn("[Auth] Warning closing auth database:", e.message);
        }
        if (memory && typeof (memory as any).close === "function") {
            try {
                await (memory as any).close();
                console.log("[Memory] Database connection closed.");
            } catch (e: any) {
                console.warn("[Memory] Warning closing database:", e.message);
            }
        }
    } catch (error: any) {
        console.error("[System] Error during shutdown:", error.message);
    }
};
