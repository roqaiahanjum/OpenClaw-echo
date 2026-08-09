// @ts-nocheck
import { ACPTask, ACPResult, TargetAgentType, WorkerAgent } from "./types";
import { ResearchSubAgent } from "./workers/ResearchSubAgent";
import { CodingSubAgent } from "./workers/CodingSubAgent";
import { BrowserSubAgent } from "./workers/BrowserSubAgent";
import { DashboardLogger } from "../core/logger";

export class SubAgentManager {
    private static instance: SubAgentManager;
    private workers: Map<TargetAgentType, WorkerAgent> = new Map();

    private constructor() {
        this.registerWorker(new ResearchSubAgent());
        this.registerWorker(new CodingSubAgent());
        this.registerWorker(new BrowserSubAgent());
    }

    public static getInstance(): SubAgentManager {
        if (!SubAgentManager.instance) {
            SubAgentManager.instance = new SubAgentManager();
        }
        return SubAgentManager.instance;
    }

    public registerWorker(worker: WorkerAgent): void {
        this.workers.set(worker.agentType, worker);
        console.log(`[SubAgentManager] Registered sub-agent worker: ${worker.agentType}`);
    }

    public async delegateTask(task: ACPTask): Promise<ACPResult> {
        const worker = this.workers.get(task.targetAgent);
        if (!worker) {
            DashboardLogger.log(`[SubAgentManager] Error: Target agent '${task.targetAgent}' not registered.`);
            return {
                taskId: task.taskId,
                targetAgent: task.targetAgent,
                status: "FAILED",
                resultData: "",
                error: `Target agent '${task.targetAgent}' not found`,
                executionTimeMs: 0
            };
        }

        DashboardLogger.log(`[ACP Protocol] Dispatching task ${task.taskId} -> Worker: ${task.targetAgent}`);
        const tStart = Date.now();

        try {
            const result = await worker.execute(task);
            const duration = Date.now() - tStart;
            DashboardLogger.log(`[ACP Protocol] Task ${task.taskId} completed by ${task.targetAgent} in ${duration}ms (Status: ${result.status})`);
            return result;
        } catch (err: any) {
            const duration = Date.now() - tStart;
            DashboardLogger.log(`[ACP Protocol] Task ${task.taskId} failed: ${err.message}`);
            return {
                taskId: task.taskId,
                targetAgent: task.targetAgent,
                status: "FAILED",
                resultData: "",
                error: err.message,
                executionTimeMs: duration
            };
        }
    }

    public async delegateTasksParallel(tasks: ACPTask[]): Promise<ACPResult[]> {
        if (!tasks || tasks.length === 0) return [];
        DashboardLogger.log(`[SubAgentManager] Executing ${tasks.length} sub-agent tasks in parallel via Promise.all()...`);
        const results = await Promise.all(tasks.map(t => this.delegateTask(t)));
        return results;
    }
}

export const subAgentManager = SubAgentManager.getInstance();
