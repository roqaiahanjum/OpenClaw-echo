// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import * as dotenv from "dotenv";

dotenv.config();

export class ModelRouter {
    private static instance: ModelRouter;
    private cloudModel: any = null;
    private localModel: any = null;

    private constructor() {
        console.log("[Router] Service initialized (Lazy Mode). Waiting for query...");
    }

    public static getInstance(): ModelRouter {
        if (!ModelRouter.instance) {
            ModelRouter.instance = new ModelRouter();
        }
        return ModelRouter.instance;
    }

    private initializeGemini() {
        if (this.cloudModel) return;

        try {
            this.cloudModel = new ChatGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_API_KEY,
                model: "gemini-2.0-flash", // Upgraded to latest supported flash model
            });
            console.log("[Router] 🟢 Google Gemini Bridge established (v1beta)!");
        } catch (error: any) {
            console.error("[Router] Gemini Handshake Error:", error.message);
        }
    }

    private initializeOllama() {
        if (this.localModel) return;
        try {
            this.localModel = new ChatOllama({
                baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
                model: process.env.OLLAMA_MODEL || "llama3:latest",
            });
            console.log("[Router] 🟢 Local Ollama Bridge established!");
        } catch (error: any) {
            console.warn("[Router] Ollama Service not detected at runtime.");
        }
    }

    // ✅ Accepts all 3 params telegram.ts passes
    async invoke(messages: any, logic?: string, options?: { tools?: any[] }) {
        this.initializeGemini();
        this.initializeOllama();

        let retries = 2;
        while (retries > 0) {
            try {
                console.log("[Router] Routing query through Gemini...");
                let model = this.cloudModel;

                // Bind tools if provided and supported
                if (options?.tools && options.tools.length > 0 && model?.bindTools) {
                    model = model.bindTools(options.tools);
                }

                if (!model) throw new Error("Gemini not initialized");

                // ✅ 40s timeout for stability as per user preference
                return await Promise.race([
                    model.invoke(messages),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error("Gemini timeout after 40s")), 40000)
                    )
                ]);
            } catch (error: any) {
                const status = error.status || (error.response ? error.response.status : "N/A");
                const msg = error.message || "Unknown error";

                console.error(`[Router] Gemini Failure | Status: ${status} | Message: ${msg}`);

                // 1. Detect Hard Quota (Immediate Fallback)
                const isHardQuota = msg.includes("429") && (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("limit"));

                if (isHardQuota || status === 404 || msg.includes("404") || msg.includes("not found")) {
                    console.error("[Router] ❌ Hard failure or Quota limit detected. Switching to fallback immediately.");
                    retries = 0; // Skip Gemini retries
                } else {
                    const isRateLimit = msg.includes("429") || status === 429 || msg.toLowerCase().includes("too many requests");
                    const isRetryable = isRateLimit || msg.includes("503") || status === 503;

                    if (isRetryable && retries > 1) {
                        console.log(`[Router] Retryable transient error (${status}). Retrying in 2s... (${retries - 1} left)`);
                        await new Promise(r => setTimeout(r, 2000));
                        retries--;
                        continue;
                    }
                }

                // 2. Fallback to Ollama if available
                if (this.localModel) {
                    try {
                        console.log(`[Router] ⚠️ Falling back to Local Ollama due to ${status}: ${msg}`);
                        return await this.localModel.invoke(messages);
                    } catch (localErr: any) {
                        console.error("[Router] Local fallback failed too:", localErr.message);
                    }
                }

                throw error;
            }
        }
    }

    // ✅ Critical for dashboard status icons
    async checkHealth() {
        if (!this.cloudModel) this.initializeGemini();
        if (!this.localModel) this.initializeOllama();

        return {
            gemini: {
                status: this.cloudModel ? "connected" : "error",
                details: this.cloudModel ? "Google Gemini Ready." : "Gemini initialization failed."
            },
            ollama: {
                status: this.localModel ? "connected" : "offline",
                details: this.localModel ? "Local service active." : "Ollama not running."
            }
        };
    }
}
