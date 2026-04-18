import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { BaseMessage } from "@langchain/core/messages";

export type RoutingLogic = "sensitive" | "simple" | "complex" | "image_analysis" | "local";

export interface RouterOptions {
    tools?: any[];
}

/**
 * ModelRouter: Safe, Lazy-initialized AI Hub
 * Supports Hybrid Failover: Gemini (Cloud) <-> Ollama (Local)
 */
export class ModelRouter {
    private cloudModel: ChatGoogleGenerativeAI | null = null;
    private localModel: ChatOllama | null = null;

    constructor() {
        console.log("[Router] Service initialized (Lazy Mode). Waiting for query...");
    }

    private ensureCloudConnected() {
        if (this.cloudModel) return;
        const rawKey = process.env.GOOGLE_API_KEY;
        if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === "") {
            throw new Error("GOOGLE_API_KEY missing.");
        }
        this.cloudModel = new ChatGoogleGenerativeAI({
            apiKey: rawKey.trim(),
            model: "gemini-1.5-flash",
            maxOutputTokens: 2048,
        });
        console.log("[Router] Gemini bridge established.");
    }

    private ensureLocalConnected() {
        if (this.localModel) return;
        this.localModel = new ChatOllama({
            baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
            model: process.env.OLLAMA_MODEL || "llama3",
        });
        console.log("[Router] Ollama local bridge initialized.");
    }

    private safeBindTools(model: any, tools?: any[]) {
        if (!tools || tools.length === 0) return model;
        try {
            if (typeof model.bindTools === 'function') {
                return model.bindTools(tools);
            }
            return model;
        } catch (error: any) {
            console.warn(`[Router] Failed to bind tools:`, error.message);
            return model;
        }
    }

    async invoke(
        messages: BaseMessage[],
        logic: RoutingLogic,
        options: RouterOptions = {}
    ): Promise<any> {
        // Direct local routing if requested
        if (logic === "local") {
            this.ensureLocalConnected();
            const bound = this.safeBindTools(this.localModel, options.tools);
            return await bound.invoke(messages);
        }

        // Standard Cloud-First with Local Fallback
        try {
            this.ensureCloudConnected();
            const bound = this.safeBindTools(this.cloudModel, options.tools);
            return await bound.invoke(messages);
        } catch (cloudError: any) {
            console.warn("[Router] Cloud execution failed. Falling back to Local (Ollama)...");
            try {
                this.ensureLocalConnected();
                const bound = this.safeBindTools(this.localModel, options.tools);
                return await bound.invoke(messages);
            } catch (localError: any) {
                console.error("[Router] Critical: Both Cloud and Local models failed.");
                throw localError;
            }
        }
    }

    async checkHealth() {
        const health = {
            gemini: { status: "disconnected", details: "Ready to connect." },
            ollama: { status: "disconnected", details: "Local bridge ready." }
        };

        if (this.cloudModel) {
            health.gemini.status = "connected";
            health.gemini.details = "Gemini 1.5 Flash live.";
        }

        // Quick check for Ollama (optional: could do a fetch to health endpoint)
        if (this.localModel) {
            health.ollama.status = "connected";
            health.ollama.details = `Ollama active (${process.env.OLLAMA_MODEL}).`;
        }

        return health;
    }
}