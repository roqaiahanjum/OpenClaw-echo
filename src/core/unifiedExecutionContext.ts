import { TargetAgentType } from "../agents/types";
import { UserIntent } from "./intentClassifier";
import { ErrorCategory, ExecutionContractStatus } from "./toolExecutionContract";

/**
 * OpenClaw Echo — Unified Execution Context
 * 
 * Shared, strongly-typed execution bus passed across all subagents,
 * tools, routing engines, and verification layers.
 * 
 * Enforces same-turn consistency, citation grounding, and truthful telemetry.
 */

export interface ExecutedToolRecord {
    toolName: string;
    invokedAt: number;
    durationMs: number;
    args: any;
    output: any;
    status: ExecutionContractStatus;
    errorCategory: ErrorCategory;
    error?: string;
}

export interface VerifiedSource {
    title: string;
    url: string;
    snippet?: string;
}

export interface MemoryDelta {
    action: "STORE" | "UPDATE" | "DELETE" | "RECALL";
    key: string;
    value: string;
    category?: string;
    timestamp: number;
}

export type PipelineStage = 
    | "INITIALIZING" 
    | "INTENT_ROUTING" 
    | "TOOL_EXECUTION" 
    | "EVIDENCE_VERIFICATION" 
    | "RESPONSE_SYNTHESIS" 
    | "COMPLETED" 
    | "FAILED";

export interface UnifiedExecutionContext {
    // 1. Traceability & Scope
    requestId: string;
    correlationId: string;
    chatId: string;
    userId?: string;
    authScope: "admin" | "authorized" | "guest" | "unauthorized";
    stage: PipelineStage;
    startTime: number;

    // 2. Intent & Goals
    rawInput: string;
    cleanedInput: string;
    intentDecision?: {
        intent: UserIntent;
        primaryAgent: TargetAgentType;
        confidence: number;
        reason: string;
    };

    // 3. Dialogue Context
    recentDialogueTurns: Array<{ user: string; bot?: string }>;
    
    // 4. Multi-Agent & Tool Tracking
    activeAgent: TargetAgentType;
    delegationStack: TargetAgentType[];
    executedTools: ExecutedToolRecord[];

    // 5. Grounded Evidence & Memory Operations
    retrievedSources: VerifiedSource[];
    memoryDeltas: MemoryDelta[];

    // 6. Outcome & Error Telemetry
    finalResponseText?: string;
    isVerifiedHonest: boolean;
    error?: {
        category: ErrorCategory;
        message: string;
        fatal: boolean;
    };
}

export class ExecutionContextManager {
    /**
     * Initializes a fresh, clean UnifiedExecutionContext for an incoming user interaction.
     */
    public static create(params: {
        rawInput: string;
        chatId: string;
        userId?: string;
        authScope?: "admin" | "authorized" | "guest" | "unauthorized";
        requestId?: string;
        correlationId?: string;
        recentTurns?: Array<{ user: string; bot?: string }>;
    }): UnifiedExecutionContext {
        const now = Date.now();
        const reqId = params.requestId || `req_${now}_${Math.random().toString(36).substring(2, 7)}`;
        const corrId = params.correlationId || `corr_${now}`;

        return {
            requestId: reqId,
            correlationId: corrId,
            chatId: params.chatId,
            userId: params.userId,
            authScope: params.authScope || "authorized",
            stage: "INITIALIZING",
            startTime: now,
            rawInput: params.rawInput,
            cleanedInput: params.rawInput.trim(),
            recentDialogueTurns: params.recentTurns || [],
            activeAgent: "conversation",
            delegationStack: [],
            executedTools: [],
            retrievedSources: [],
            memoryDeltas: [],
            isVerifiedHonest: false
        };
    }

    /**
     * Records a tool execution into the context bus.
     */
    public static recordToolExecution(
        ctx: UnifiedExecutionContext, 
        record: ExecutedToolRecord
    ): void {
        ctx.executedTools.push(record);

        // If web_search, extract verified sources
        if (record.toolName === "web_search" && record.status === "SUCCESS" && typeof record.output === "string") {
            const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
            let match: RegExpExecArray | null;
            while ((match = urlRegex.exec(record.output)) !== null) {
                const title = match[1];
                const url = match[2];
                if (!ctx.retrievedSources.some(s => s.url === url)) {
                    ctx.retrievedSources.push({ title, url });
                }
            }
        }
    }

    /**
     * Records a memory delta (write or update) into the context bus.
     */
    public static recordMemoryDelta(
        ctx: UnifiedExecutionContext, 
        delta: MemoryDelta
    ): void {
        ctx.memoryDeltas.push(delta);
    }
}

