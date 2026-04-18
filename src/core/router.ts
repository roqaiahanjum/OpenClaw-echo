// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import * as dotenv from "dotenv";

dotenv.config();

export class ModelRouter {
    private cloudModel: any = null;
    private localModel: any = null;

    constructor() {
        console.log("[Router] Service initialized (Lazy Mode). Waiting for query...");
    }

    private initializeGemini() {
        if (this.cloudModel) return;

        try {
            this.cloudModel = new ChatGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_API_KEY,
                model: "gemini-1.5-flash", 
                apiVersion: "v1", // ✅ Explicitly setting stable v1 to avoid 404 on v1beta
            });
            console.log("[Router] 🟢 Google Gemini Bridge established (v1)!");
        } catch (error: any) {
            console.error("[Router] Gemini Handshake Error:", error.message);
        }
    }

    private initializeOllama() {
        if (this.localModel) return;
        try {
            this.localModel = new ChatOllama({
                baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
                model: process.env.OLLAMA_MODEL || "llama3",
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
                return await model.invoke(messages);
            } catch (error: any) {
                const status = error.status || (error.response ? error.response.status : "N/A");
                const msg = error.message || "Unknown error";
                
                console.error(`[Router] Gemini Failure | Status: ${status} | Message: ${msg}`);
                
                // Specialized handling for 404 (Model Not Found) - don't retry, fallback immediately
                if (status === 404 || msg.includes("404") || msg.includes("not found")) {
                    console.error("[Router] ❌ Model configuration error detected (404). Switching to fallback.");
                    retries = 0; // Skip retries
                } else {
                    const isRateLimit = msg.includes("429") || status === 429 || msg.toLowerCase().includes("too many requests");
                    const isRetryable = isRateLimit || msg.includes("503") || status === 503;
                    
                    if (isRetryable && retries > 1) {
                        console.log(`[Router] Retryable error hit (${status}). Retrying in 5s... (${retries - 1} left)`);
                        await new Promise(r => setTimeout(r, 5000));
                        retries--;
                        continue;
                    }
                }

                // Fallback to Ollama if available
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
