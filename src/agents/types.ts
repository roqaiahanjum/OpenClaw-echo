// @ts-nocheck

export type TargetAgentType = 
    | 'conversation'
    | 'research' 
    | 'coding' 
    | 'memory'
    | 'browser'
    | 'planner';

export interface ACPTask {
    taskId: string;
    parentId: string;
    targetAgent: TargetAgentType;
    taskDescription: string;
    contextPayload?: Record<string, any>;
    maxDepth?: number;
    dependsOn?: string[];
}

export interface ACPResult {
    taskId: string;
    targetAgent: TargetAgentType;
    status: 'SUCCESS' | 'FAILED' | 'DELEGATED';
    resultData: string;
    toolName?: string;
    toolOutput?: any;
    verified?: boolean;
    verificationReason?: string;
    error?: string;
    executionTimeMs: number;
}

export interface WorkerAgent {
    readonly agentType: TargetAgentType;
    execute(task: ACPTask): Promise<ACPResult>;
}
