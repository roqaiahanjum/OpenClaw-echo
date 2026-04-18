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

dotenv.config();

/**
 * OpenClaw Echo: Integrated Telegram Server
 * Supports: Vision, 6-Step Autonomous Flow, Webhook/Polling, Test-Drive, and Dynamic Personalities.
 */

const bot = new Telegraf(process.env.TELEGRAM_TOKEN || "");
const router = new ModelRouter();
const memory = new MemoryManager();
const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3005");
const WEBHOOK_PATH = "/api/webhook";

// State Management
let activePersonality: PersonalityMode = "standard";

/**
 * THE ENGINE: A reusable 6-step autonomous flow.
 */
async function executeAutonomousFlow(input: string, chatId: string, isPhoto: boolean, replyFn: (content: string) => Promise<any>, photoLink?: string, isRetry: boolean = false) {
    try {
        const persona = PERSONALITIES[activePersonality];
        DashboardLogger.log(`[Persona] Active: ${persona.label}`);
        DashboardLogger.log(`[Flow] Step 1: Processing interaction for ${chatId}`);

        // 2. Context retrieval + Trimming (Requirement: max 1500 chars)
        DashboardLogger.log(`[Flow] Step 2: Retrieving and trimming context...`);
        let context = await memory.getContext(input);
        if (context.length > 1500) {
            context = context.slice(0, 1500) + "... [Truncated]";
            DashboardLogger.log(`[System] Context trimmed for token safety.`);
        }

        // 3. Model Invocation
        DashboardLogger.log(`[Flow] Step 3: Invoking ModelRouter...`);
        const tools = SkillRegistry.getTools();
        
        let messageContent: any = input;
        if (isPhoto && photoLink) {
            messageContent = [
                { type: "text", text: input },
                { type: "image_url", image_url: { url: photoLink } }
            ];
        }

        let messages: any[] = [
            new SystemMessage(`${persona.prompt} 
            Rules:
            - Use tools if needed.
            - Check local knowledge base via 'read_sandbox_file' or 'user_profile.txt'.
            - If an image is provided, describe it or follow instructions.
            - Context from history (trimmed): 
            ${context}`),
            new HumanMessage({ content: messageContent })
        ];

        // 4. Autonomous Tool Execution Loop
        DashboardLogger.log(`[Flow] Step 4: Executing autonomous cycle...`);
        let finalResponse = "";
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (iterations < MAX_ITERATIONS) {
            const logic = isPhoto ? "image_analysis" : "complex";
            const response = await router.invoke(messages, logic, { tools });
            const tool_calls = (response as any).tool_calls || [];

            if (tool_calls.length > 0 && !isPhoto) {
                messages.push(response);
                for (const toolCall of tool_calls) {
                    const tool = SkillRegistry.getToolByName(toolCall.name);
                    if (tool) {
                        DashboardLogger.log(`[Status] Executing ${toolCall.name}...`);
                        const output = await tool.invoke(toolCall.args);
                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id,
                            content: String(output)
                        }));
                    }
                }
                iterations++;
            } else {
                finalResponse = response.content as string;
                break;
            }
        }

        // 5. Reply
        DashboardLogger.log(`[Flow] Step 5: Replying...`);
        await replyFn(finalResponse);

        // 6. Persistence
        DashboardLogger.log(`[Flow] Step 6: Persisting interaction...`);
        await memory.addInteraction(input, finalResponse);

        // Broadcast to Dashboard to refresh state
        Telemetry.broadcast("status_update", { event: "flow_complete" });

    } catch (error: any) {
        // Detailed terminal logging
        console.error("[Fatal]", error.status || "N/A", error.message);
        DashboardLogger.log(`[Fatal] Flow Error Logic: ${error.message}`);

        const isRateLimit = error.message.includes("429") || error.status === 429 || error.message.toLowerCase().includes("too many requests");
        const isTimeout = error.message.includes("503") || error.status === 503 || error.message.toLowerCase().includes("timeout");
        
        // Rate Limit Handling (Attempt retry once)
        if (isRateLimit && !isRetry) {
            DashboardLogger.log("[Status] Rate limit detected. Waiting 2s for retry...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            return executeAutonomousFlow(input, chatId, isPhoto, replyFn, photoLink, true);
        }

        // Specific user feedback
        let userFeedback = `❌ Error: ${error.message}`;
        
        if (isRateLimit) {
            userFeedback = "I'm thinking, please resend your message in a few seconds";
        } else if (isTimeout) {
            userFeedback = "Connection issue, please try again";
        } else if (error.message.includes("tokens")) {
            userFeedback = "⚠️ The message is too long for my current memory buffer.";
        }
        
        await replyFn(userFeedback);
    }
}

/**
 * Splits long text into chunks that fit within Telegram's character limit.
 */
function splitMessage(text: string, maxLength: number = 4000): string[] {
    const chunks: string[] = [];
    let current = text;
    while (current.length > 0) {
        if (current.length <= maxLength) {
            chunks.push(current);
            break;
        }
        let splitIndex = current.lastIndexOf("\n", maxLength);
        if (splitIndex <= 100) splitIndex = maxLength; // Fallback if no good newline found
        chunks.push(current.substring(0, splitIndex).trim());
        current = current.substring(splitIndex).trim();
    }
    return chunks;
}

/**
 * Telegram Adapter: Maps Telegraf context to the Engine.
 */
async function telegramHandler(ctx: Context) {
    if (!ctx.message) return;
    
    // @ts-ignore - telegraf filters handle this but TS doesn't see it
    const input = (ctx.message as any).text || (ctx.message as any).caption || "Analyze this image.";
    const isPhoto = !!(ctx.message as any).photo;
    let photoLink = undefined;

    if (isPhoto) {
        const photo = (ctx.message as any).photo[(ctx.message as any).photo.length - 1];
        const link = await ctx.telegram.getFileLink(photo.file_id);
        photoLink = link.href;
    }

    await executeAutonomousFlow(
        input, 
        String(ctx.chat?.id), 
        isPhoto, 
        async (content) => { 
            const chunks = splitMessage(content);
            for (const chunk of chunks) {
                await ctx.reply(chunk);
            }
        },
        photoLink
    );
}

// Handlers
bot.command("start", (ctx) => ctx.reply("🚀 OpenClaw Echo is online and ready! Port: " + PORT));
bot.on(message("text"), telegramHandler);
bot.on(message("photo"), telegramHandler);

// Express Routes
app.get("/", async (req: Request, res: Response) => {
    try {
        const dashboardPath = path.join(__dirname, "dashboard.html");
        const content = await fs.readFile(dashboardPath, "utf-8");
        res.send(content);
    } catch (err) {
        res.status(500).send("OpenClaw Echo: Dashboard Error.");
    }
});

app.get("/api/stream", (req: Request, res: Response) => {
    Telemetry.subscribe(res);
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

/**
 * 🌐 OMNICHANNEL CHAT ENDPOINT
 */
app.post("/api/chat", async (req: Request, res: Response) => {
    const { message: userMsg } = req.body;
    if (!userMsg) return res.status(400).json({ error: "Missing message" });

    DashboardLogger.log(`[WebChat] Inbound from dashboard user.`);

    let agentResponse = "";
    
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
});

app.get("/api/sandbox", async (req: Request, res: Response) => {
    try {
        const sandboxDir = path.resolve("src/sandbox");
        const files = await fs.readdir(sandboxDir);
        res.json(files);
    } catch (err) {
        res.json([]);
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

        const content = await fs.readFile(filePath, "utf-8");
        res.send(content);
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
        
        // Return unique sources
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

import { Clockwork } from "../core/clockwork";

app.get("/api/schedules", async (req: Request, res: Response) => {
    try {
        const tasks = await Clockwork.listTasks();
        res.json(tasks);
    } catch (err) {
        res.json([]);
    }
});

// Wire Clockwork to the autonomous flow
Clockwork.setExecutor(async (prompt: string) => {
    await executeAutonomousFlow(
        prompt,
        "CLOCKWORK_SCHEDULER",
        false,
        async (content) => { DashboardLogger.log(`[Clockwork Result] ${content}`); }
    );
});

// Boot all persisted schedules
Clockwork.boot().catch(err => console.error("[Clockwork] Boot failed:", err));

/**
 * 🚀 TEST DRIVE ENDPOINT
 */
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

// Start Server
export const startServer = async () => {
    if (!process.env.TELEGRAM_TOKEN) {
        console.error("[Fatal] TELEGRAM_TOKEN missing.");
        process.exit(1);
    }

    const mode = (process.env.TELEGRAM_MODE || "polling").toLowerCase();
    
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, async () => {
            DashboardLogger.log(`🚀 OPENCLAW ECHO: ${mode.toUpperCase()} MODE ACTIVATED`);
            if (mode === "webhook") {
                const WEBHOOK_URL = `${process.env.TELEGRAM_WEBHOOK_URL}${WEBHOOK_PATH}`;
                try {
                    await bot.telegram.setWebhook(WEBHOOK_URL);
                    DashboardLogger.log("✅ Webhook registered.");
                } catch (err: any) { }
            } else {
                bot.launch().catch(err => { });
                DashboardLogger.log("✅ Polling active.");
            }
            resolve(server);
        });

        server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                const FALLBACK_PORT = PORT + 1;
                if (FALLBACK_PORT <= 3006) {
                    console.warn(`[System] Port ${PORT} busy. Retrying on ${FALLBACK_PORT}...`);
                    app.listen(FALLBACK_PORT, () => {
                        console.log(`🚀 OPENCLAW ECHO: FALLBACK MODE ACTIVATED ON PORT ${FALLBACK_PORT}`);
                        bot.launch().catch(err => { });
                        resolve(server);
                    });
                } else {
                    console.error(`\n[Fatal] Port ${PORT} and ${FALLBACK_PORT} are both in use.`);
                    console.error(`[Manual Fix] Run this PowerShell command to clear the port:`);
                    console.error(`Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`);
                    process.exit(1);
                }
            } else {
                reject(err);
            }
        });
    });
};

export const stopServer = async (server: any) => {
    console.log("\n[System] Graceful shutdown initiated...");
    try {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
            console.log("[System] Express server stopped.");
        }
        await bot.stop();
        console.log("[System] Telegram bot stopped.");
        await memory.close();
    } catch (error: any) {
        console.error("[System] Error during shutdown:", error.message);
    }
};
