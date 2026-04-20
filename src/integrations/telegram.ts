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

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN || "");
const router = ModelRouter.getInstance();
const memory = MemoryManager.getInstance();
const app = express();
app.use(express.json());

const dashboardPath = path.resolve("dashboard/dist");
app.use(express.static(dashboardPath));

const PORT = parseInt(process.env.PORT || "3005");
const WEBHOOK_PATH = "/api/webhook";

let activePersonality: PersonalityMode = "standard";

async function executeAutonomousFlow(input: string, chatId: string, isPhoto: boolean, replyFn: (content: string) => Promise<any>, photoLink?: string, isRetry: boolean = false) {
    try {
        const persona = PERSONALITIES[activePersonality];
        DashboardLogger.log(`[Persona] Active: ${persona.label}`);
        DashboardLogger.log(`[Flow] Step 1: Processing interaction for ${chatId}`);

        DashboardLogger.log(`[Flow] Step 2: Retrieving and trimming context...`);
        let context = "";
        try {
            context = await memory.getContext(input);
        } catch (e: any) {
            context = "No previous context available.";
        }

        // ✅ Fix 2: Reduced to 500 chars for faster Railway response
        if (context.length > 500) {
            context = context.slice(0, 500) + "... [Truncated]";
            DashboardLogger.log(`[System] Context trimmed for token safety.`);
        }

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
            new SystemMessage(`You are OpenClaw Echo, a helpful AI assistant.
Be brief and direct. Max 2-3 sentences.
Context: ${context}`),
            new HumanMessage({ content: messageContent })
        ];

        DashboardLogger.log(`[Flow] Step 4: Executing autonomous cycle...`);
        let finalResponse = "";
        let iterations = 0;
        const MAX_ITERATIONS = 3;

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

        DashboardLogger.log(`[Flow] Step 5: Replying...`);
        await replyFn(finalResponse);

        DashboardLogger.log(`[Flow] Step 6: Persisting interaction...`);
        await memory.addInteraction(input, finalResponse);

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

        let userFeedback = `❌ Error: ${error.message}`;

        if (isHardQuota) {
            userFeedback = "⚠️ Quota exceeded. Please try again later.";
        } else if (isRateLimit) {
            userFeedback = "I'm thinking, please resend your message in a few seconds.";
        } else if (isTimeout) {
            userFeedback = "⏱️ Connection issue, please try again.";
        } else if (msg.includes("tokens")) {
            userFeedback = "⚠️ Message too long for my memory buffer.";
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

bot.command("start", (ctx) => ctx.reply("🚀 OpenClaw Echo is online and ready! Port: " + PORT));

bot.command("clear", async (ctx) => {
    try {
        await memory.clearHistory();
        await ctx.reply("🧹 Memory cleared! What's on your mind?");
        DashboardLogger.log(`[System] User requested memory clear.`);
    } catch (e) {
        await ctx.reply("❌ Error clearing memory.");
    }
});

bot.on(message("text"), telegramHandler);
bot.on(message("photo"), telegramHandler);

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

app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(dashboardPath, "index.html"), (err) => {
        if (err) res.status(404).send("Dashboard not built.");
    });
});

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

            Clockwork.setExecutor(async (prompt: string) => {
                await executeAutonomousFlow(
                    prompt,
                    "CLOCKWORK_SCHEDULER",
                    false,
                    async (content) => {
                        DashboardLogger.log(`[Clockwork] Result: ${content.slice(0, 200)}`);
                    }
                );
            });
            await Clockwork.boot();
            resolve(server);
        });

        server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                const FALLBACK_PORT = PORT + 1;
                if (FALLBACK_PORT <= 3006) {
                    console.warn(`[System] Port ${PORT} busy. Retrying on ${FALLBACK_PORT}...`);
                    app.listen(FALLBACK_PORT, () => {
                        bot.launch().catch(err => { });
                        resolve(server);
                    });
                } else {
                    process.exit(1);
                }
            } else {
                reject(err);
            }
        });
    });
};

export const stopServer = async (server: any) => {
    try {
        if (server) await new Promise((resolve) => server.close(resolve));
        await bot.stop();
        await memory.close();
    } catch (error: any) {
        console.error("[System] Error during shutdown:", error.message);
    }
};