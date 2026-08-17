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
import { verifyStepResult } from "../core/verifier";
import { determineRecoveryStrategy } from "../core/recovery";
import { localVerifyToolResult } from "../core/localVerifier";
import { isSimpleConversation } from "../core/conversationGuard";

import { telemetry } from "./telemetry";

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN || "");
const router = ModelRouter.getInstance();
const memory = MemoryManager.getInstance();
const app = express();
app.use(express.json());
app.use(express.static(path.resolve("public")));

const dashboardPath = path.resolve("dashboard/dist");
app.use(express.static(dashboardPath));

const PORT = parseInt(process.env.PORT || "3005");
const WEBHOOK_PATH = "/api/webhook";

let activePersonality: PersonalityMode = "standard";

async function safeSend(ctx: any, text: string, options: any = {}) {
    const MAX = 3800;
    if (text.length <= MAX) {
        try {
            await ctx.reply(text, { parse_mode: 'Markdown', ...options });
        } catch {
            await ctx.reply(text, options); // fallback: no markdown
        }
        return;
    }
    // Split into chunks
    const chunks = [];
    let current = '';
    for (const line of text.split('\n')) {
        if ((current + '\n' + line).length > MAX) {
            chunks.push(current);
            current = line;
        } else {
            current += (current ? '\n' : '') + line;
        }
    }
    if (current) chunks.push(current);
    
    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, { parse_mode: 'Markdown', ...options });
        } catch {
            await ctx.reply(chunk, options);
        }
        await new Promise(r => setTimeout(r, 300)); // small delay between chunks
    }
}

const invokeWithTimeout = async (messages: any[], mode?: string, options?: any) => {
    const controller = new AbortController();
    const timeoutMs = 55000;
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error('LLM_TIMEOUT'));
        }, timeoutMs);
    });

    const mergedOptions = { ...options, signal: controller.signal };

    try {
        return await Promise.race([
            ModelRouter.getInstance().invokeWithRetry(messages, mode, mergedOptions),
            timeoutPromise,
        ]);
    } finally {
        clearTimeout(timer!);
    }
};

export const executeAutonomousFlow = async (input: string, chatId?: string | number, isPhoto?: boolean, replyFn?: any, photoLink?: string, isRetry?: boolean) => {
    try {
        const persona = PERSONALITIES[activePersonality];
        DashboardLogger.log(`[Persona] Active: ${persona.label}`);
        DashboardLogger.log(`[Flow] Step 1: Processing interaction for ${chatId}`);

        const tStart = Date.now();
        DashboardLogger.log(`[Flow] Step 2: Retrieving context across 4 memory layers...`);
        let context = "";
        const tMemStart = Date.now();
        try {
            context = await memory.getContext(input, chatId?.toString() || 'default');
        } catch (e: any) {
            context = "No previous context available.";
        }
        const tMemEnd = Date.now();
        DashboardLogger.log(`[Memory] Retrieval: ${tMemEnd - tMemStart}ms`);

        const simpleGreetings = ['hi', 'hello', 'hey', 'thanks', 'ok', 'okay', 'bye', 'good morning', 'good night'];
        const isSimpleMessage = simpleGreetings.some(g => input.toLowerCase().trim() === g);

        if ((isSimpleMessage || isSimpleConversation(input)) && !isPhoto) {
            DashboardLogger.log(`[FastPath] FAST PATH DETECTED — Skipping tool loading (1 Gemini Call).`);
            const systemPromptText = `You are OpenClaw Echo, a helpful AI assistant. Be brief, polite, and direct (max 2-3 sentences).\nContext: ${context}`;
            const simpleMessages = [
                new SystemMessage(systemPromptText),
                new HumanMessage(input)
            ];

            const response: any = await invokeWithTimeout(simpleMessages, "simple");
            const replyText = (response.content as string) || "Hello! How can I help you today?";

            await replyFn(replyText);
            memory.addInteraction(input, replyText, chatId?.toString() || 'default')
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        // ◄── DIRECT SEARCH FAST-PATH ──►
        const searchKeywords = ["search", "find", "latest news", "google", "look up", "news"];
        const lowerInput = input.toLowerCase().trim();
        const isSearchQuery = searchKeywords.some(kw => lowerInput.includes(kw));

        if (isSearchQuery && !isPhoto) {
            DashboardLogger.log(`[SearchFastPath] DIRECT SEARCH FAST-PATH DETECTED — Bypassing planner & invoking web_search tool directly.`);
            const webSearchTool = SkillRegistry.getToolByName("web_search");
            let rawSearchResults = "";
            if (webSearchTool) {
                try {
                    rawSearchResults = await webSearchTool.invoke({ query: input });
                } catch (sErr: any) {
                    rawSearchResults = "Web search service temporarily unavailable.";
                }
            }

            const searchSystemPrompt = `You are OpenClaw Echo, a helpful AI assistant.
Synthesize these web search results clearly and concisely for the user (max 3-4 bullet points or sentences).
Web Search Results:
${rawSearchResults}

Context:
${context}`;

            const searchMessages = [
                new SystemMessage(searchSystemPrompt),
                new HumanMessage(input)
            ];

            let replyText = "";
            try {
                const response: any = await invokeWithTimeout(searchMessages, "search_fastpath");
                replyText = (response.content as string) || rawSearchResults;
            } catch (sErr: any) {
                console.warn("[SearchFastPath] Gemini synthesis timed out or failed. Sending clean formatted search results directly.");
                replyText = rawSearchResults;
            }

            await replyFn(replyText);
            memory.addInteraction(input, replyText, chatId?.toString() || 'default')
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        DashboardLogger.log(`[Flow] Step 3: Invoking ModelRouter...`);

        const tools = SkillRegistry.getTools();
        const toolNames = tools.map((t: any) => t.name);
        const plan = await generateSmartPlan(input, toolNames);
        let planText = "";
        if (plan) {
            planText = formatPlanForPrompt(plan);
        }

        // ◄── SUB-AGENT DELEGATION FAST-PATH (Phase 7 & 8) ──►
        const lowerInputStr = input.toLowerCase();
        const isMultiAgentTask = (
            (lowerInputStr.includes("research") && (lowerInputStr.includes("code") || lowerInputStr.includes("script") || lowerInputStr.includes("write"))) ||
            lowerInputStr.includes("multi-step") ||
            lowerInputStr.includes("delegate")
        );

        if (isMultiAgentTask && !isPhoto) {
            DashboardLogger.log(`[OmniSubAgent] MULTI-AGENT DELEGATION DETECTED — Dispatching via SubAgentManager & ACP Protocol.`);
            const acpTasks = decomposeIntoACPTasks(input, plan ? JSON.stringify(plan) : undefined);
            const workerResults = await SubAgentManager.getInstance().delegateTasksParallel(acpTasks);

            const finalReply = workerResults.map(res => {
                if (res.status === 'SUCCESS') return res.resultData;
                return `⚠️ [${(res.targetAgent || 'WORKER').toUpperCase()} Task Failed]: ${res.error || 'Unknown error'}`;
            }).join('\n\n---\n\n');

            const finalResponse = finalReply || "Sub-agent delegation completed successfully.";
            await replyFn(finalResponse);
            memory.addInteraction(input, finalResponse, chatId?.toString() || 'default')
                .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));
            Telemetry.broadcast("status_update", { event: "flow_complete" });
            return;
        }

        let messageContent: any = input;
        if (isPhoto && photoLink) {
            messageContent = [
                { type: "text", text: input },
                { type: "image_url", image_url: { url: photoLink } }
            ];
        }

        let systemPromptText = `CRITICAL INSTRUCTION:
Before using ANY tool, check your memory context above.
If the answer exists in KNOWN FACTS or RECENT HISTORY,
answer directly from memory WITHOUT calling any tool.
Only use tools when memory does not have the answer.
Never use local_file_system to answer questions about
your own identity, project name, or user information —
this information is already in your memory context.

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
        const MAX_ITERATIONS = 15;
        let recoveryAttempts = 0;
        const MAX_RECOVERY_ATTEMPTS = 2;

        while (iterations < MAX_ITERATIONS) {
            const logic = isPhoto ? "image_analysis" : "complex";
            const response: any = await invokeWithTimeout(messages, "agent", { tools });
            const tool_calls = (response as any).tool_calls || [];

            if (tool_calls.length > 0 && !isPhoto) {
                messages.push(response);
                for (const toolCall of tool_calls) {
                    const tool = SkillRegistry.getToolByName(toolCall.name);
                    if (tool) {
                        DashboardLogger.log(`[Status] Executing ${toolCall.name}...`);
                        let output: string;
                        try {
                            output = String(await tool.invoke(toolCall.args));
                        } catch (toolErr: any) {
                            output = `Error executing tool '${toolCall.name}': ${toolErr.message || toolErr}`;
                            console.error(`[Tool Error] Failed to execute ${toolCall.name}:`, toolErr);
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
        await replyFn(finalResponse);

        DashboardLogger.log(`[Flow] Step 6: Persisting interaction across 4 memory layers...`);
        memory.addInteraction(input, finalResponse, chatId?.toString() || 'default')
            .catch(err => console.warn("[Memory] Background interaction persistence warning:", err.message));

        Telemetry.broadcast("status_update", { event: "flow_complete" });

    } catch (error: any) {
        console.error("[Fatal]", error.status || "N/A", error.message);
        DashboardLogger.log(`[Fatal] Flow Error Logic: ${error.message}`);

        const msg = error.message || "";
        const isRateLimit = msg.includes("429") || error.status === 429 || msg.toLowerCase().includes("too many requests");
        const isHardQuota = isRateLimit && (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("limit"));
        const isTimeout = msg.includes("503") || error.status === 503 || msg.toLowerCase().includes("timeout");

        if (isRateLimit && !isRetry && !isHardQuota) {
            DashboardLogger.log("[Status] Transient rate limit detected. Waiting 2s for retry...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            return executeAutonomousFlow(input, chatId, isPhoto, replyFn, photoLink, true);
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

        await replyFn(userFeedback);
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

async function telegramHandler(ctx: Context) {
    if (!ctx.message) return;

    const input = (ctx.message as any).text || (ctx.message as any).caption || "Analyze this image.";
    const isPhoto = !!(ctx.message as any).photo;
    let photoLink = undefined;

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
        await ctx.reply("Hello! I am OpenClaw Echo. My tools and agents are online. How can I help you today?");
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

    try {
        let isFirstReply = true;

        // FIX 4B: 60-second flow timeout
        const flowTimeout = new Promise<string>((resolve) =>
            setTimeout(() => resolve(
                "⏳ I'm still working on your request — this is a complex task and I need a bit more time. Please send your message again and I'll try a faster approach."
            ), 180000)
        );

        const replyHandler = async (finalResponse: string) => {
                if (isFirstReply && statusMessageId !== null) {
                    isFirstReply = false;
                    try {
                        await ctx.telegram.editMessageText(
                            ctx.chat?.id,
                            statusMessageId,
                            undefined,
                            finalResponse.length <= 3800 ? finalResponse : finalResponse.substring(0, 3800),
                            { parse_mode: "Markdown" }
                        );
                        if (finalResponse.length > 3800) {
                            await safeSend(ctx, finalResponse.substring(3800));
                        }
                    } catch (err: any) {
                        const errMsg = err.message || "";
                        if (errMsg.includes("message is not modified")) {
                            // Ignore
                        } else if (errMsg.includes("can't parse entities")) {
                            try {
                                await ctx.telegram.editMessageText(
                                    ctx.chat?.id,
                                    statusMessageId,
                                    undefined,
                                    finalResponse.length <= 3800 ? finalResponse : finalResponse.substring(0, 3800)
                                );
                                if (finalResponse.length > 3800) {
                                    await safeSend(ctx, finalResponse.substring(3800));
                                }
                            } catch (innerErr) {
                                await safeSend(ctx, finalResponse);
                            }
                        } else {
                            await safeSend(ctx, finalResponse);
                        }
                    }
                } else {
                    await safeSend(ctx, finalResponse);
                }
        };

        const flowPromise = executeAutonomousFlow(
            input,
            String(ctx.chat?.id),
            isPhoto,
            replyHandler,
            photoLink
        );

        // Race: flow vs 60s timeout
        const timeoutResult = await Promise.race([
            flowPromise.then(() => null),
            flowTimeout
        ]);

        if (timeoutResult !== null) {
            // Flow timed out — send timeout message
            await replyHandler(timeoutResult);
        }
    } finally {
        clearInterval(typingInterval);
    }
}

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
        const facts = await memory.getAllFacts();
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
        const result = await memory.searchMemory(query);
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
        const publicDashboardPath = path.resolve("public/dashboard.html");
        res.sendFile(publicDashboardPath);
    } catch (err) {
        res.status(500).send("OpenClaw Echo: Dashboard Error.");
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

app.post(WEBHOOK_PATH, async (req: Request, res: Response) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (err) {
        res.status(500).send("Error");
    }
});

app.use((err: any, req: Request, res: Response, next: any) => {
    console.error("[Server Error]", err.stack);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
});

app.get("/health", (req: Request, res: Response) => {
    res.status(200).send("OK");
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

    const mode = (process.env.TELEGRAM_MODE || "polling").toLowerCase();
    const basePort = initialPort || parseInt(process.env.PORT || "3005");
    const MAX_ATTEMPTS = 10;

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

            // Connect Telegram
            if (mode === "webhook") {
                const WEBHOOK_URL = `${process.env.TELEGRAM_WEBHOOK_URL}${WEBHOOK_PATH}`;
                try {
                    await bot.telegram.setWebhook(WEBHOOK_URL, { drop_pending_updates: true });
                    DashboardLogger.log("✅ Webhook registered.");
                } catch (err: any) {
                    console.error("[Telegram] Webhook setup failed:", err.message);
                }
            } else {
                try {
                    await bot.launch({ dropPendingUpdates: true });
                    DashboardLogger.log("✅ Polling active.");
                } catch (err: any) {
                    console.error("[Telegram] Init error / Webhook conflict:", err.message);
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

export const stopServer = async (server: any) => {
    try {
        if (server && server.close) {
            await new Promise((resolve) => server.close(resolve));
        }
        if (bot && typeof bot.stop === "function") {
            try {
                await bot.stop("SIGINT");
            } catch (e) { }
        }
        if (memory && typeof (memory as any).close === "function") {
            await (memory as any).close();
        }
    } catch (error: any) {
        console.error("[System] Error during shutdown:", error.message);
    }
};
