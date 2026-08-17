// @ts-nocheck
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { AIMessage } from "@langchain/core/messages";
import Groq from "groq-sdk";
import * as dotenv from "dotenv";

dotenv.config();

function sanitizeToolSchema(tool: any): any {
    const schema = tool.schema;
    if (!schema) return tool;

    // Convert Zod schema to clean JSON Schema
    const cleanSchema = {
        type: 'object',
        properties: {} as Record<string, any>,
        required: [] as string[],
    };

    // Extract properties from Zod schema shape
    const shape = schema._def?.shape?.() || schema.shape || {};

    for (const [key, value] of Object.entries(shape)) {
        const zodField = value as any;
        const fieldType = zodField._def?.typeName || 'ZodString';

        let jsonType = 'string';
        if (fieldType === 'ZodNumber') jsonType = 'number';
        if (fieldType === 'ZodBoolean') jsonType = 'boolean';
        if (fieldType === 'ZodArray') jsonType = 'array';
        if (fieldType === 'ZodObject') jsonType = 'object';
        if (fieldType === 'ZodEnum') jsonType = 'string';
        if (fieldType === 'ZodOptional') {
            const innerType = zodField._def?.innerType?._def?.typeName || 'ZodString';
            if (innerType === 'ZodNumber') jsonType = 'number';
            if (innerType === 'ZodBoolean') jsonType = 'boolean';
            if (innerType === 'ZodArray') jsonType = 'array';
        }

        const description = zodField._def?.description ||
            zodField.description ||
            key;

        cleanSchema.properties[key] = {
            type: jsonType,
            description: description,
        };

        // Add enum values if present
        if (fieldType === 'ZodEnum') {
            cleanSchema.properties[key].enum = zodField._def?.values || [];
        }

        // Only add to required if not optional
        if (fieldType !== 'ZodOptional') {
            cleanSchema.required.push(key);
        }
    }

    return {
        name: tool.name,
        description: tool.description,
        parameters: cleanSchema,
    };
}

export interface ProviderCandidate {
    id: string;
    name: string;
    provider: "gemini" | "groq";
    modelName: string;
}

const WATERFALL_PROVIDERS: ProviderCandidate[] = [
    { id: "groq-llama-8b", name: "Groq Llama 8B", provider: "groq", modelName: process.env.GROQ_MODEL || "llama3-8b-8192" },
    { id: "gemini-3.6-flash", name: "Gemini 2.5 Flash", provider: "gemini", modelName: process.env.GEMINI_MODEL || "gemini-2.5-flash" }
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

function extractToolMetadata(t: any) {
    // If it's a LangChain tool, get its OpenAI format which has JSON schema parameters
    const tool = typeof t.bind === "function" ? convertToOpenAITool(t) : t;

    const name = tool.name || tool.function?.name || "";
    const description = tool.description || tool.function?.description || "";
    let parameters = tool.schema || tool.parameters || tool.function?.parameters || { type: "object", properties: {} };

    // Deep clone to avoid mutating originals
    parameters = JSON.parse(JSON.stringify(parameters));

    // Strip unsupported schema properties
    delete parameters.$schema;
    delete parameters.additionalProperties;
    delete (parameters as any).lc;
    delete (parameters as any).id;

    return { name, description, parameters };
}

function formatGroqTool(tool: any) {
    const { name, description, parameters } = extractToolMetadata(tool);
    return {
        type: "function",
        function: {
            name,
            description,
            parameters,
        },
    };
}

function formatGeminiTool(tool: any) {
    const { name, description, parameters } = extractToolMetadata(tool);
    return {
        name,
        description,
        parameters,
    };
}

export class ModelRouter {
    private static instance: ModelRouter;
    private groqClient: Groq | null = null;

    // Circuit Breaker & Quota Tracking State
    private failedModelsCooldown: Map<string, number> = new Map();
    private requestTimestamps: number[] = [];
    private dailyRequestCount: number = 0;
    private lastDayReset: number = Date.now();

    // Groq RPM Rate Limiter
    private groqCallsThisMinute = 0;
    private groqMinuteStart = Date.now();

    private checkGroqRateLimit(): boolean {
        const now = Date.now();
        // Reset counter every 60 seconds
        if (now - this.groqMinuteStart > 60000) {
            this.groqCallsThisMinute = 0;
            this.groqMinuteStart = now;
        }
        this.groqCallsThisMinute++;
        // Stop using Groq if approaching limit (25 of 30 RPM)
        if (this.groqCallsThisMinute > 25) {
            console.warn('[Router] Groq RPM limit approaching — skipping Groq this cycle.');
            return false; // do not call Groq
        }
        return true; // OK to call Groq
    }

    private constructor() {
        console.log("[Router] Service initialized (Gemini + Groq Multi-Provider Waterfall Engine).");

        const apiKey =
            process.env.GOOGLE_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GEMINI_KEY;

        if (!apiKey) {
            console.error('[Router] FATAL: No Gemini API key found.');
            console.error('[Router] Set GOOGLE_API_KEY in your .env file.');
        }

        const groqKey =
            process.env.GROQ_API_KEY ||
            process.env.GROQ_KEY;

        if (groqKey) {
            try {
                this.groqClient = new Groq({ apiKey: groqKey });
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

    public isModelInCooldown(modelId: string): boolean {
        const cooldownUntil = this.failedModelsCooldown.get(modelId);
        if (cooldownUntil && Date.now() < cooldownUntil) {
            return true;
        }
        if (cooldownUntil) {
            this.failedModelsCooldown.delete(modelId);
        }
        return false;
    }

    public tripCircuitBreakerForModel(modelId: string): void {
        const cooldownTime = Date.now() + 5 * 60 * 1000; // 5 minutes cooldown
        this.failedModelsCooldown.set(modelId, cooldownTime);
        console.warn(`[Router] ⚠️ QUOTA CIRCUIT BREAKER TRIPPED for model [${modelId}] — Cooldown active until ${new Date(cooldownTime).toLocaleTimeString()}.`);
    }

    public isInFallbackMode(): boolean {
        const standardCandidates = ["groq-llama-8b", "gemini-flash-2.5"];
        return standardCandidates.every(id => this.isModelInCooldown(id));
    }

    public resetCircuitBreaker(): void {
        this.failedModelsCooldown.clear();
        console.log("[Router] 🟢 Quota Circuit Breaker reset for all models.");
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
    private async invokeProvider(candidate: ProviderCandidate, messages: any, logic?: string, options?: { tools?: any[], signal?: AbortSignal }): Promise<any> {
        const controller = new AbortController();
        if (options?.signal) {
            if (options.signal.aborted) {
                throw new Error("Request aborted before starting provider");
            }
            options.signal.addEventListener('abort', () => controller.abort());
        }

        if (candidate.provider === "gemini") {
            const apiKey =
                process.env.GOOGLE_API_KEY ||
                process.env.GEMINI_API_KEY ||
                process.env.GEMINI_KEY;
            if (!apiKey) throw new Error("GOOGLE_API_KEY / GEMINI_API_KEY missing");

            let model = new ChatGoogleGenerativeAI({
                apiKey: apiKey,
                model: candidate.modelName,
                temperature: 0.7
            });

            if (options?.tools && options.tools.length > 0 && model.bindTools) {
                const sanitizedTools = options.tools.map(sanitizeToolSchema);
                const functionDeclarations = sanitizedTools.map(formatGeminiTool);
                const googleTools = [{ functionDeclarations }];
                model = model.bindTools(googleTools as any);
            }

            let timer: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Gemini (${candidate.modelName}) request timed out after 120s`));
                }, 120000);
            });

            try {
                return await Promise.race([
                    model.invoke(messages, { signal: controller.signal }),
                    timeoutPromise
                ]);
            } finally {
                clearTimeout(timer!);
            }
        } else if (candidate.provider === "groq") {
            const apiKey =
                process.env.GROQ_API_KEY ||
                process.env.GROQ_KEY;
            if (!apiKey) throw new Error("GROQ_API_KEY missing");

            if (!this.groqClient) {
                this.groqClient = new Groq({ apiKey });
            }

            const formattedMessages = translateMessagesToGroq(messages);

            let groqTools = undefined;
            if (logic !== 'graph_extractor' && options?.tools && options.tools.length > 0) {
                const sanitizedTools = options.tools.map(sanitizeToolSchema);
                groqTools = sanitizedTools.map(formatGroqTool);
            }

            const completionParams: any = {
                messages: formattedMessages,
                model: candidate.modelName,
                temperature: 0.7,
            };
            if (groqTools && groqTools.length > 0) {
                completionParams.tools = groqTools;
                completionParams.tool_choice = "auto";
            }

            const completionPromise = this.groqClient.chat.completions.create(completionParams, { signal: controller.signal });

            let timer: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Groq (${candidate.modelName}) request timed out after 90s`));
                }, 90000);
            });

            let response: any;
            try {
                response = await Promise.race([
                    completionPromise,
                    timeoutPromise
                ]);
            } finally {
                clearTimeout(timer!);
            }

            const messageObj = response.choices?.[0]?.message;
            let toolCalls: any[] = [];

            if (messageObj?.tool_calls && messageObj.tool_calls.length > 0) {
                toolCalls = messageObj.tool_calls.map((tc: any) => {
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(tc.function.arguments);
                    } catch (e) {
                        console.warn("[Router] Failed to parse Groq tool call arguments:", tc.function.arguments);
                    }
                    return {
                        name: tc.function.name,
                        args: parsedArgs
                    };
                });
            }

            const textOutput = messageObj?.content || "";
            return new AIMessage({
                content: textOutput,
                tool_calls: toolCalls
            });
        } else {
            throw new Error(`Unsupported provider type: ${candidate.provider}`);
        }
    }

    /**
     * Core Waterfall Invocation Engine
     * Cycles through WATERFALL_PROVIDERS sequentially if previous providers fail or time out.
     */
    async invoke(messages: any, logic?: string, options?: { tools?: any[], signal?: AbortSignal }): Promise<any> {
        const metrics = this.trackRequestMetrics();

        // Dynamically build the candidate providers list based on logic mode
        let providers = [...WATERFALL_PROVIDERS];

        if (logic === "graph_extractor") {
            // Prioritize Groq candidate as the primary model for extraction
            const index = providers.findIndex(p => p.id === "groq-llama-8b" || p.provider === "groq");
            if (index !== -1) {
                const [model] = providers.splice(index, 1);
                providers.unshift(model);
            }
        } else if (logic === "coding_subagent" || logic === "research_subagent") {
            // Inject llama-3.3-70b-versatile right after Gemini 2.5 Flash
            const geminiIndex = providers.findIndex(p => p.id === "gemini-flash-2.5");
            const groq70b: ProviderCandidate = {
                id: "groq-llama-3.3-70b",
                name: "Groq Llama 3.3 70B",
                provider: "groq",
                modelName: "llama-3.3-70b-versatile"
            };
            if (geminiIndex !== -1) {
                providers.splice(geminiIndex + 1, 0, groq70b);
            } else {
                providers.unshift(groq70b);
            }
        }

        let lastErrorMsg = "Unknown";
        for (const candidate of providers) {
            if (options?.signal?.aborted) {
                throw new Error("Request aborted by global timeout");
            }
            if (this.isModelInCooldown(candidate.id)) {
                console.log(`[Router] Skipping model [${candidate.id}] — Currently in Cooldown.`);
                continue;
            }
            // Groq RPM rate limit check
            if (candidate.provider === "groq" && !this.checkGroqRateLimit()) {
                console.log(`[Router] Skipping Groq — RPM limit approaching.`);
                continue;
            }
            try {
                console.log(`[Router] Waterfall -> Invoking Provider [${candidate.name} / ${candidate.modelName}] (RPM: ${metrics.rpm}, RPD: ${metrics.rpd}, Logic: ${logic || "N/A"})...`);
                const response = await this.invokeProvider(candidate, messages, logic, options);
                return response;
            } catch (error: any) {
                if (options?.signal?.aborted) {
                    throw new Error("Request aborted by global timeout");
                }
                lastErrorMsg = error.message;
                console.warn(`[Router] Waterfall Failover: Provider [${candidate.name}] failed: ${error.message}. Trying next provider...`);

                const msg = String(error?.message || "");
                const errCode = error?.code || error?.error?.code || "";
                const isNotFound =
                    error?.status === 404 ||
                    error?.statusCode === 404 ||
                    errCode === "model_not_found" ||
                    msg.includes("404") ||
                    msg.includes("model_not_found") ||
                    msg.includes("Model not found");

                const isQuotaOrExhausted =
                    error?.status === 429 ||
                    msg.includes("429") ||
                    msg.includes("free_tier_requests") ||
                    msg.includes("Quota exceeded") ||
                    msg.includes("ResourceExhausted");

                if (isNotFound) {
                    console.warn(`[Router] ⚠️ Model [${candidate.modelName}] not found (404/model_not_found). Cooling down model [${candidate.id}] and failing over.`);
                    this.tripCircuitBreakerForModel(candidate.id);
                } else if (isQuotaOrExhausted) {
                    this.tripCircuitBreakerForModel(candidate.id);
                }
            }
        }

        throw new Error(`All upstream AI providers in waterfall loop failed. Last error: ${lastErrorMsg}`);
    }

    /**
     * Resilient Waterfall Invocation with Retry & Degradation
     */
    async invokeWithRetry(messages: any, mode?: string, options?: any, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (options?.signal?.aborted) {
                throw new Error("Request aborted by global timeout");
            }
            if (this.isInFallbackMode()) {
                console.warn(`[Router] Circuit Breaker Fallback Active (all standard providers down). Returning graceful degradation alert.`);
                return {
                    content: "⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."
                };
            }

            try {
                return await this.invoke(messages, mode, options);
            } catch (error: any) {
                if (options?.signal?.aborted) {
                    throw new Error("Request aborted by global timeout");
                }

                if (attempt >= maxRetries) {
                    console.error(`[Router] Max retries (${maxRetries}) reached across all providers in waterfall.`);
                    return {
                        content: "⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."
                    };
                }

                const waitMs = 5000 * attempt;
                console.log(`[Router] Retrying waterfall loop in ${waitMs}ms (attempt ${attempt}/${maxRetries})...`);

                // Wait, checking for abort during sleep
                await new Promise((resolve, reject) => {
                    if (options?.signal?.aborted) return reject(new Error("Request aborted by global timeout"));
                    const timeoutId = setTimeout(resolve, waitMs);
                    if (options?.signal) {
                        options.signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error("Request aborted by global timeout"));
                        });
                    }
                });
            }
        }
    }

    async checkHealth() {
        const hasGemini = !!(
            process.env.GOOGLE_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GEMINI_KEY
        );
        const hasGroq = !!(
            process.env.GROQ_API_KEY ||
            process.env.GROQ_KEY
        );

        return {
            gemini: {
                status: hasGemini ? "connected" : "error",
                fallbackMode: this.isModelInCooldown("gemini-flash-2.5"),
                details: hasGemini ? "Google Gemini Bridge Ready." : "GOOGLE_API_KEY missing."
            },
            groq: {
                status: hasGroq ? "connected" : "offline",
                fallbackMode: this.isModelInCooldown("groq-llama-8b"),
                details: hasGroq ? "Groq SDK Active." : "GROQ_API_KEY missing."
            },
            ollama: {
                status: "offline",
                details: "Ollama not running."
            }
        };
    }
}
