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

export interface RouterInvokeOptions {
    tools?: any[];
    signal?: AbortSignal;
    providerTimeoutMs?: number;
    primaryTimeoutMs?: number;
    perProviderTimeoutMap?: Record<string, number>;
    reqId?: string;
    logic?: string;
}

const cleanModelName = (name: string | undefined, defaultName: string) => {
    if (!name) return defaultName;
    const cleaned = name.replace(/^["']|["']$/g, "").trim();
    if (!cleaned || cleaned === "llama3-8b-8192" || cleaned === "llama-3.3-70b-versatile" || cleaned === "gemini-2.5-flash" || cleaned === "gemini-3.6-flash") return defaultName;
    return cleaned;
};

const WATERFALL_PROVIDERS: ProviderCandidate[] = [
    { id: "groq-fast", name: "Groq Fast", provider: "groq", modelName: cleanModelName(process.env.GROQ_MODEL, "openai/gpt-oss-20b") },
    { id: "gemini-flash", name: "Gemini Flash", provider: "gemini", modelName: cleanModelName(process.env.GEMINI_MODEL, "gemini-3.5-flash-lite") },
    { id: "groq-backup", name: "Groq Backup", provider: "groq", modelName: "openai/gpt-oss-120b" },
    { id: "gemini-fallback", name: "Gemini 3.5 Flash Lite Backup", provider: "gemini", modelName: "gemini-3.5-flash-lite" }
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
    private groqPrimaryClient: Groq | null = null;
    private groqBackupClient: Groq | null = null;

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

        const primaryGroqKey =
            process.env.GROQ_PRIMARY_API_KEY ||
            process.env.GROQ_API_KEY ||
            process.env.GROQ_KEY;

        const backupGroqKey =
            process.env.GROQ_BACKUP_API_KEY ||
            process.env.GROQ_API_KEY ||
            process.env.GROQ_KEY;

        if (primaryGroqKey) {
            try {
                this.groqPrimaryClient = new Groq({ apiKey: primaryGroqKey });
                this.groqClient = this.groqPrimaryClient;
                console.log("[Router] 🟢 Groq Primary SDK initialized.");
            } catch (e: any) {
                console.warn("[Router] Groq Primary SDK initialization skipped:", e.message);
            }
        }

        if (backupGroqKey) {
            try {
                this.groqBackupClient = new Groq({ apiKey: backupGroqKey });
                console.log("[Router] 🟢 Groq Backup SDK initialized.");
            } catch (e: any) {
                console.warn("[Router] Groq Backup SDK initialization skipped:", e.message);
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
        const standardCandidates = ["groq-fast", "gemini-flash", "groq-backup", "gemini-fallback"];
        const activeStandard = standardCandidates.filter(id => WATERFALL_PROVIDERS.some(p => p.id === id));
        return activeStandard.length > 0 && activeStandard.every(id => this.isModelInCooldown(id));
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
    private async invokeProvider(candidate: ProviderCandidate, messages: any, logicOrOptions?: any, maybeOptions?: any): Promise<any> {
        let logic = typeof logicOrOptions === "string" ? logicOrOptions : undefined;
        const options: RouterInvokeOptions = (typeof logicOrOptions === "object" && logicOrOptions !== null ? logicOrOptions : maybeOptions) || {};
        if (!logic && options.logic) {
            logic = options.logic;
        }
        const controller = new AbortController();
        if (options?.signal) {
            if (options.signal.aborted) {
                throw new Error("Request aborted before starting provider");
            }
            options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        const tStart = Date.now();

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

            let perProviderTimeoutMs = 25000;
            if (options?.perProviderTimeoutMap?.[candidate.id]) {
                perProviderTimeoutMs = options.perProviderTimeoutMap[candidate.id];
            } else if (options?.providerTimeoutMs && !options?.primaryTimeoutMs) {
                perProviderTimeoutMs = options.providerTimeoutMs;
            }
            let timer: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`ProviderTimeoutError: Gemini (${candidate.modelName}) request timed out after ${perProviderTimeoutMs}ms`));
                }, perProviderTimeoutMs);
            });

            if (options?.reqId) {
                console.log(`[DIAG:${options.reqId}] 6. LLM request started (Provider: gemini, Model: ${candidate.modelName})`);
            }
            try {
                const result = await Promise.race([
                    model.invoke(messages, { signal: controller.signal }),
                    timeoutPromise
                ]);
                const latencyMs = Date.now() - tStart;
                if (options?.reqId) {
                    console.log(`[DIAG:${options.reqId}] 7. LLM response received (Provider: gemini, Latency: ${latencyMs}ms)`);
                }
                console.log(`[StructuredLog] [Event:ModelCall] [Provider:gemini] [Model:${candidate.modelName}] [LatencyMs:${latencyMs}] [Status:Success]`);
                return result;
            } catch (err: any) {
                const latencyMs = Date.now() - tStart;
                console.warn(`[StructuredLog] [Event:ModelCall] [Provider:gemini] [Model:${candidate.modelName}] [LatencyMs:${latencyMs}] [Status:Failed] [Error:${err.message}]`);
                throw err;
            } finally {
                clearTimeout(timer!);
            }
        } else if (candidate.provider === "groq") {
            const isBackup = candidate.id === "groq-backup";
            const apiKey = isBackup
                ? (process.env.GROQ_BACKUP_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_KEY)
                : (process.env.GROQ_PRIMARY_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_KEY);
            if (!apiKey) throw new Error("GROQ_API_KEY missing");

            let activeGroqClient: Groq;
            if (isBackup) {
                if (!this.groqBackupClient) {
                    this.groqBackupClient = new Groq({ apiKey });
                }
                activeGroqClient = this.groqBackupClient;
            } else {
                if (!this.groqPrimaryClient) {
                    this.groqPrimaryClient = new Groq({ apiKey });
                    this.groqClient = this.groqPrimaryClient;
                }
                activeGroqClient = this.groqPrimaryClient;
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

            const completionPromise = activeGroqClient.chat.completions.create(completionParams, { signal: controller.signal });

            let perProviderTimeoutMs = 20000;
            if (options?.perProviderTimeoutMap?.[candidate.id]) {
                perProviderTimeoutMs = options.perProviderTimeoutMap[candidate.id];
            } else if (candidate.id === "groq-fast" && options?.primaryTimeoutMs) {
                perProviderTimeoutMs = options.primaryTimeoutMs;
            } else if (options?.providerTimeoutMs && candidate.id === "groq-fast") {
                perProviderTimeoutMs = options.providerTimeoutMs;
            }
            let timer: NodeJS.Timeout;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`ProviderTimeoutError: Groq (${candidate.modelName}) request timed out after ${perProviderTimeoutMs}ms`));
                }, perProviderTimeoutMs);
            });

            if (options?.reqId) {
                console.log(`[DIAG:${options.reqId}] 6. LLM request started (Provider: groq, Model: ${candidate.modelName})`);
            }
            let response: any;
            try {
                response = await Promise.race([
                    completionPromise,
                    timeoutPromise
                ]);
                const latencyMs = Date.now() - tStart;
                if (options?.reqId) {
                    console.log(`[DIAG:${options.reqId}] 7. LLM response received (Provider: groq, Latency: ${latencyMs}ms)`);
                }
                console.log(`[StructuredLog] [Event:ModelCall] [Provider:groq] [Model:${candidate.modelName}] [LatencyMs:${latencyMs}] [Status:Success]`);
            } catch (err: any) {
                const latencyMs = Date.now() - tStart;
                console.warn(`[StructuredLog] [Event:ModelCall] [Provider:groq] [Model:${candidate.modelName}] [LatencyMs:${latencyMs}] [Status:Failed] [Error:${err.message}]`);
                throw err;
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
                        id: tc.id || `call_${Math.random().toString(36).substring(2, 9)}`,
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
    async invoke(messages: any, logic?: string, options?: RouterInvokeOptions): Promise<any> {
        const metrics = this.trackRequestMetrics();

        // Dynamically build the candidate providers list based on logic mode
        let rawProviders = [...WATERFALL_PROVIDERS];

        if (logic === "graph_extractor") {
            // Prioritize Groq candidate as the primary model for extraction
            const index = rawProviders.findIndex(p => p.id === "groq-fast" || p.id === "groq-llama-8b" || p.provider === "groq");
            if (index !== -1) {
                const [model] = rawProviders.splice(index, 1);
                rawProviders.unshift(model);
            }
        } else if (logic === "coding_subagent" || logic === "research_subagent") {
            const groqLarge: ProviderCandidate = {
                id: "groq-large",
                name: "Groq Large",
                provider: "groq",
                modelName: cleanModelName(process.env.GROQ_LARGE_MODEL, "openai/gpt-oss-120b")
            };
            const geminiIndex = rawProviders.findIndex(p => p.id === "gemini-flash" || p.provider === "gemini");
            if (geminiIndex !== -1) {
                rawProviders.splice(geminiIndex + 1, 0, groqLarge);
            } else {
                rawProviders.unshift(groqLarge);
            }
        }

        // Deduplicate providers by provider:modelName
        const providers: ProviderCandidate[] = [];
        const seen = new Set<string>();
        for (const cand of rawProviders) {
            const key = `${cand.provider}:${cand.modelName}`;
            if (!seen.has(key)) {
                seen.add(key);
                providers.push(cand);
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
                if (options?.reqId) {
                    console.log(`[DIAG:${options.reqId}] 5. Provider selected: ${candidate.name} (${candidate.modelName})`);
                }
                console.log(`[Router] Waterfall -> Invoking Provider [${candidate.name} / ${candidate.modelName}] (RPM: ${metrics.rpm}, RPD: ${metrics.rpd}, Logic: ${logic || "N/A"})...`);
                const response = await this.invokeProvider(candidate, messages, { ...options, logic });
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
                    errCode === "model_decommissioned" ||
                    msg.includes("404") ||
                    msg.includes("model_not_found") ||
                    msg.includes("model_decommissioned") ||
                    msg.includes("Model not found") ||
                    msg.includes("decommissioned");

                const isQuotaOrExhausted =
                    error?.status === 429 ||
                    msg.includes("429") ||
                    msg.includes("free_tier_requests") ||
                    msg.includes("Quota exceeded") ||
                    msg.includes("ResourceExhausted") ||
                    msg.includes("Too Many Requests");

                if (isNotFound) {
                    console.warn(`[Router] ⚠️ Model [${candidate.modelName}] unavailable (not found/decommissioned). Cooling down model [${candidate.id}] and failing over.`);
                    this.tripCircuitBreakerForModel(candidate.id);
                } else if (isQuotaOrExhausted) {
                    this.tripCircuitBreakerForModel(candidate.id);
                }
            }
        }

        throw new Error(`All upstream AI providers in waterfall loop failed. Last error: ${lastErrorMsg}`);
    }

    /**
     * Resilient Waterfall Invocation with Fast Fallback & Degradation
     */
    async invokeWithRetry(messages: any, mode?: string, options?: RouterInvokeOptions, maxRetries = 2) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (options?.signal?.aborted) {
                throw new Error("Request aborted by global timeout");
            }
            if (this.isInFallbackMode()) {
                console.warn(`[Router] Circuit Breaker Fallback Active (all standard providers down). Returning graceful degradation alert immediately.`);
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

                if (attempt >= maxRetries || this.isInFallbackMode()) {
                    console.error(`[Router] Waterfall exhausted (attempt ${attempt}/${maxRetries}, fallbackMode: ${this.isInFallbackMode()}).`);
                    return {
                        content: "⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."
                    };
                }

                const waitMs = 500 * attempt;
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
                fallbackMode: this.isModelInCooldown("gemini-flash"),
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
