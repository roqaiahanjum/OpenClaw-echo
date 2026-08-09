// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import Groq from "groq-sdk";
import * as dotenv from "dotenv";

dotenv.config();

export interface ProviderCandidate {
    id: string;
    name: string;
    provider: "gemini" | "groq";
    modelName: string;
}

const WATERFALL_PROVIDERS: ProviderCandidate[] = [
    { id: "gemini-flash-2.5", name: "Gemini 2.5 Flash", provider: "gemini", modelName: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
    { id: "gemini-flash-2.0", name: "Gemini 2.0 Flash", provider: "gemini", modelName: "gemini-2.0-flash" },
    { id: "groq-llama-3.1-8b", name: "Groq Llama 3.1 8B", provider: "groq", modelName: "llama-3.1-8b-instant" },
    { id: "groq-llama-3-8b", name: "Groq Llama 3 8B", provider: "groq", modelName: "llama3-8b-8192" },
    { id: "groq-mixtral-8x7b", name: "Groq Mixtral 8x7B", provider: "groq", modelName: "mixtral-8x7b-32768" }
];

function translateMessagesToGroq(messages: any[]): Array<{ role: string; content: string }> {
    if (!Array.isArray(messages)) {
        return [{ role: "user", content: String(messages || "") }];
    }

    return messages.map((m: any) => {
        let role = "user";
        let content = "";

        if (typeof m === "string") {
            return { role: "user", content: m };
        }

        const msgType = m._getType ? m._getType() : (m.role || m.type || "user");
        if (msgType === "system") role = "system";
        else if (msgType === "human" || msgType === "user") role = "user";
        else if (msgType === "ai" || msgType === "assistant") role = "assistant";
        else role = "user";

        if (typeof m.content === "string") {
            content = m.content;
        } else if (Array.isArray(m.content)) {
            content = m.content.map((c: any) => typeof c === "string" ? c : (c.text || JSON.stringify(c))).join("\n");
        } else {
            content = JSON.stringify(m.content || m);
        }

        return { role, content };
    });
}

export class ModelRouter {
    private static instance: ModelRouter;
    private groqClient: Groq | null = null;

    // Circuit Breaker & Quota Tracking State
    private isFallbackModeActive: boolean = false;
    private requestTimestamps: number[] = [];
    private dailyRequestCount: number = 0;
    private lastDayReset: number = Date.now();

    private constructor() {
        console.log("[Router] Service initialized (Gemini + Groq Multi-Provider Waterfall Engine).");
        if (process.env.GROQ_API_KEY) {
            try {
                this.groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
                console.log("[Router] 🟢 Groq SDK initialized with active API key.");
            } catch (e: any) {
                console.warn("[Router] Groq SDK initialization skipped:", e.message);
            }
        }
    }

    public static getInstance(): ModelRouter {
        if (!ModelRouter.instance) {
            ModelRouter.instance = new ModelRouter();
        }
        return ModelRouter.instance;
    }

    public isInFallbackMode(): boolean {
        return this.isFallbackModeActive;
    }

    public tripCircuitBreaker(): void {
        if (!this.isFallbackModeActive) {
            this.isFallbackModeActive = true;
            console.warn("[Router] ⚠️ QUOTA CIRCUIT BREAKER TRIPPED — Entering Quota-Conserving Fallback Mode.");
        }
    }

    public resetCircuitBreaker(): void {
        this.isFallbackModeActive = false;
        console.log("[Router] 🟢 Quota Circuit Breaker reset to Normal Mode.");
    }

    private trackRequestMetrics(): { rpm: number; rpd: number } {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);
        this.requestTimestamps.push(now);

        if (now - this.lastDayReset > 86400000) {
            this.dailyRequestCount = 0;
            this.lastDayReset = now;
            this.resetCircuitBreaker();
        }
        this.dailyRequestCount++;

        return { rpm: this.requestTimestamps.length, rpd: this.dailyRequestCount };
    }

    /**
     * Unified Provider Invocation
     * Executes single provider attempt with individual 30-second timeout cap.
     */
    private async invokeProvider(candidate: ProviderCandidate, messages: any, options?: { tools?: any[] }): Promise<any> {
        if (candidate.provider === "gemini") {
            const apiKey = process.env.GOOGLE_API_KEY;
            if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

            let model = new ChatGoogleGenerativeAI({
                apiKey: apiKey,
                model: candidate.modelName,
                temperature: 0.7
            });

            if (options?.tools && options.tools.length > 0 && model.bindTools) {
                model = model.bindTools(options.tools);
            }

            return await Promise.race([
                model.invoke(messages),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Gemini (${candidate.modelName}) request timed out after 30s`)), 30000)
                )
            ]);
        } else if (candidate.provider === "groq") {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) throw new Error("GROQ_API_KEY missing");

            if (!this.groqClient) {
                this.groqClient = new Groq({ apiKey });
            }

            const formattedMessages = translateMessagesToGroq(messages);

            const completionPromise = this.groqClient.chat.completions.create({
                messages: formattedMessages,
                model: candidate.modelName,
                temperature: 0.7
            });

            const response: any = await Promise.race([
                completionPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Groq (${candidate.modelName}) request timed out after 30s`)), 30000)
                )
            ]);

            const textOutput = response.choices?.[0]?.message?.content || "";
            return { content: textOutput };
        } else {
            throw new Error(`Unsupported provider type: ${candidate.provider}`);
        }
    }

    /**
     * Core Waterfall Invocation Engine
     * Cycles through WATERFALL_PROVIDERS sequentially if previous providers fail or time out.
     */
    async invoke(messages: any, logic?: string, options?: { tools?: any[] }): Promise<any> {
        const metrics = this.trackRequestMetrics();

        for (const candidate of WATERFALL_PROVIDERS) {
            try {
                console.log(`[Router] Waterfall -> Invoking Provider [${candidate.name} / ${candidate.modelName}] (RPM: ${metrics.rpm}, RPD: ${metrics.rpd})...`);
                const response = await this.invokeProvider(candidate, messages, options);
                return response;
            } catch (error: any) {
                console.warn(`[Router] Waterfall Failover: Provider [${candidate.name}] failed: ${error.message}. Trying next provider...`);
            }
        }

        throw new Error("All upstream AI providers in waterfall loop failed");
    }

    /**
     * Resilient Waterfall Invocation with Retry & Degradation
     */
    async invokeWithRetry(messages: any, mode?: string, options?: any, maxRetries = 2) {
        if (this.isFallbackModeActive) {
            console.warn(`[Router] Circuit Breaker Fallback Active. Returning graceful degradation alert.`);
            return {
                content: "⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."
            };
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.invoke(messages, mode, options);
            } catch (error: any) {
                const msg = error?.message || "";
                const isQuotaOrExhausted =
                    error?.status === 429 ||
                    msg.includes("429") ||
                    msg.includes("free_tier_requests") ||
                    msg.includes("Quota exceeded") ||
                    msg.includes("ResourceExhausted");

                if (isQuotaOrExhausted) {
                    this.tripCircuitBreaker();
                }

                if (attempt >= maxRetries) {
                    console.error(`[Router] Max retries (${maxRetries}) reached across all providers in waterfall.`);
                    return {
                        content: "⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."
                    };
                }

                const waitMs = 4000 * attempt;
                console.log(`[Router] Retrying waterfall loop in ${waitMs}ms (attempt ${attempt}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, waitMs));
            }
        }
    }

    async checkHealth() {
        const hasGemini = !!process.env.GOOGLE_API_KEY;
        const hasGroq = !!process.env.GROQ_API_KEY;

        return {
            gemini: {
                status: hasGemini ? "connected" : "error",
                fallbackMode: this.isFallbackModeActive,
                details: hasGemini ? "Google Gemini Bridge Ready." : "GOOGLE_API_KEY missing."
            },
            groq: {
                status: hasGroq ? "connected" : "offline",
                details: hasGroq ? "Groq SDK Active." : "GROQ_API_KEY missing."
            }
        };
    }
}
