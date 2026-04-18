// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";

dotenv.config();

export class ModelRouter {
    private cloudModel: any = null;

    constructor() {
        console.log("[Router] Service initialized (Lazy Mode). Waiting for query...");
    }

    private initializeGemini() {
        if (this.cloudModel) return;

        try {
            this.cloudModel = new ChatGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_API_KEY,
                model: "gemini-2.5-flash-lite", // 🚀 Higher limits + 2026 Stable
            });
            console.log("[Router] 🟢 Google Gemini Bridge established!");
        } catch (error: any) {
            console.error("[Router] Fatal Handshake Error:", error.message);
            throw new Error(`Gemini handshake failed: ${error.message}`);
        }
    }

    // ✅ Now accepts all 3 params telegram.ts passes
    async invoke(messages: any, logic?: string, options?: { tools?: any[] }) {
        this.initializeGemini();
        try {
            console.log("[Router] Routing query through Gemini...");

            // ✅ Bind tools if provided
            let model = this.cloudModel;
            if (options?.tools && options.tools.length > 0) {
                model = this.cloudModel.bindTools(options.tools);
            }

            return await model.invoke(messages);
        } catch (error: any) {
            console.error("[Router] Execution Error:", error.message);
            throw error;
        }
    }

    // ✅ Added checkHealth (called by telegram.ts /api/status)
    async checkHealth() {
        return {
            status: "connected",
            model: "gemini-2.5-flash-lite",
            details: "Google Gemini API Ready."
        };
    }
}