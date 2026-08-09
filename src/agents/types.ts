// @ts-nocheck

export type TargetAgentType = 'research' | 'coding' | 'browser';

export interface ACPTask {
    taskId: string;
    parentId: string;
    targetAgent: TargetAgentType;
    taskDescription: string;
    contextPayload?: Record<string, any>;
    maxDepth?: number;
}

export interface ACPResult {
    taskId: string;
    targetAgent: TargetAgentType;
    status: 'SUCCESS' | 'FAILED' | 'DELEGATED';
    resultData: string;
    error?: string;
    executionTimeMs: number;
}

export interface WorkerAgent {
    readonly agentType: TargetAgentType;
    execute(task: ACPTask): Promise<ACPResult>;
}

