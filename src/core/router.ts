// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";

dotenv.config();

export class ModelRouter {
    private static instance: ModelRouter;
    private cloudModel: any = null;

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
                model: "gemini-2.5-flash",
                temperature: 0.7
            });
            console.log("[Router] 🟢 Google Gemini Bridge established.");
        } catch (error: any) {
            console.error("[Router] Gemini Handshake Error:", error.message);
        }
    }

    async invoke(messages: any, logic?: string, options?: { tools?: any[] }) {
        this.initializeGemini();

        let retries = 0;
        while (retries >= 0) {
            try {
                console.log("[Router] Routing query through Gemini...");
                let model = this.cloudModel;

                if (options?.tools && options.tools.length > 0 && model?.bindTools) {
                    model = model.bindTools(options.tools);
                }

                if (!model) throw new Error("Gemini not initialized");

                return await Promise.race([
                    model.invoke(messages),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Gemini timeout after 60s")), 60000)
                    )
                ]);
            } catch (error: any) {
                const msg = error.message || "Unknown error";
                console.error(`[Router] Gemini Failure: ${msg}`);

                const isQuota = msg.includes("429") || msg.toLowerCase().includes("quota");
                const isAuth = msg.includes("401") || msg.includes("403");

                if (isQuota || isAuth || retries === 0) {
                    throw error;
                }

                console.log(`[Router] Retrying... (${retries} left)`);
                retries--;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    async checkHealth() {
        if (!this.cloudModel) this.initializeGemini();
        return {
            gemini: {
                status: this.cloudModel ? "connected" : "error",
                details: this.cloudModel ? "Google Gemini Ready." : "Gemini initialization failed."
            },
            ollama: {
                status: "offline",
                details: "Ollama disabled in cloud mode."
            }
        };
    }
} 
