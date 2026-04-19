// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * ModelRouter: The Intelligence Switching Layer
 * Optimized for Railway/Cloud: Features strict 15s timeouts and pre-invocation safety pings.
 */
export class ModelRouter {
    private static instance: ModelRouter;
    private cloudModel: any = null;
    private localModel: any = null;
    private isGeminiVerified = false;

    private constructor() {
        console.log("[Router] Service initialized (Cloud-Native Mode).");
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
                model: "gemini-2.0-flash",
                temperature: 0.7,
            });
            console.log("[Router] 🟢 Google Gemini Bridge established.");
        } catch (error: any) {
            console.error("[Router] Gemini Handshake Error:", error.message);
        }
    }
    private initializeOllama() {
        // ✅ Ollama disabled on cloud deployment
        if (process.env.USE_OLLAMA !== "true") {
            console.log("[Router] Ollama disabled in cloud mode.");
            return;
        }
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
    /**
     * Safety Ping: Verifies connectivity and key validity in < 5s.
     * Prevents long hangs on Railway when the API key is invalid or quota is dead.
     */
    private async verifyConnectivity(): Promise<boolean> {
        if (this.isGeminiVerified) return true;
        if (!this.cloudModel) return false;

        try {
            console.log("[Router] Verifying Gemini Safety Ping...");
            await Promise.race([
                this.cloudModel.invoke([new HumanMessage("ping")]),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Ping Timeout")), 5000)
                )
            ]);
            this.isGeminiVerified = true;
            return true;
        } catch (error: any) {
            const msg = error.message.toLowerCase();
            if (msg.includes("api_key_invalid") || msg.includes("401") || msg.includes("403")) {
                throw new Error("Invalid API Key: Please check your GOOGLE_API_KEY on Railway.");
            }
            if (msg.includes("quota") || msg.includes("429")) {
                throw new Error("Quota Exceeded: Gemini API limit reached.");
            }
            throw new Error(`Connectivity Failed: ${error.message}`);
        }
    }

    async invoke(messages: any, logic?: string, options?: { tools?: any[] }) {
        this.initializeGemini();
        this.initializeOllama();

        // 1. Safety Check (Pre-flight)
        try {
            await this.verifyConnectivity();
        } catch (error: any) {
            console.error(`[Router] Pre-flight Failed: ${error.message}`);
            // Fallback immediately if pre-flight fails
            if (this.localModel) {
                console.log("[Router] Attempting immediate fallback to Ollama...");
                return await this.localModel.invoke(messages);
            }
            throw error;
        }

        let retries = 1; // Reduced retries for faster cloud failover
        while (retries >= 0) {
            try {
                console.log("[Router] Routing query through Gemini...");
                let model = this.cloudModel;

                if (options?.tools && options.tools.length > 0 && model?.bindTools) {
                    model = model.bindTools(options.tools);
                }

                if (!model) throw new Error("Gemini not initialized");

                // ✅ Strict 15s timeout for Railway responsiveness
                return await Promise.race([
                    model.invoke(messages),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Gemini timeout after 15s")), 15000)
                    )
                ]);
            } catch (error: any) {
                const msg = error.message || "Unknown error";
                console.error(`[Router] Gemini Failure: ${msg}`);

                const isQuota = msg.includes("429") || msg.toLowerCase().includes("quota");
                const isAuth = msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("key");

                if (isQuota || isAuth || retries === 0) {
                    if (this.localModel) {
                        console.log(`[Router] ⚠️ Falling back to Local Ollama...`);
                        return await this.localModel.invoke(messages);
                    }
                    throw error;
                }

                console.log(`[Router] Retrying Gemini... (${retries} left)`);
                retries--;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    async checkHealth() {
        if (!this.cloudModel) this.initializeGemini();
        if (!this.localModel) this.initializeOllama();

        return {
            gemini: {
                status: this.isGeminiVerified ? "connected" : "pending",
                details: this.isGeminiVerified ? "Google Gemini Verified & Ready." : "Awaiting first handshake."
            },
            ollama: {
                status: this.localModel ? "connected" : "offline",
                details: this.localModel ? "Local service active." : "Ollama not running."
            }
        };
    }
}
