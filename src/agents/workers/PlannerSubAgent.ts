import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SubAgentManager } from "../SubAgentManager";
import { decomposeIntoACPTasks, generateSmartPlan } from "../../core/planner";
import { SkillRegistry } from "../../skills/registry";
import { DashboardLogger } from "../../core/logger";

/**
 * PlannerSubAgent
 *
 * Decomposes complex, multi-step user prompts into a directed acyclic graph (DAG)
 * of subagent tasks, orchestrates their execution across specialized workers
 * with dependency resolution, and aggregates verified outputs.
 */
export class PlannerSubAgent implements WorkerAgent {
    public readonly agentType = "planner" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[PlannerSubAgent] Planning & executing multi-step task ${task.taskId}: "${task.taskDescription}"`);

        try {
            const toolNames = SkillRegistry.getTools().map((t: any) => t.name);
            const smartPlan = await generateSmartPlan(task.taskDescription, toolNames);
            const planString = smartPlan ? JSON.stringify(smartPlan) : undefined;

            // Decompose into DAG tasks
            const subTasks = decomposeIntoACPTasks(task.taskDescription, planString);
            const userChatId = task.contextPayload?.chatId ? String(task.contextPayload.chatId) : undefined;
            if (userChatId) {
                subTasks.forEach(st => {
                    st.contextPayload = st.contextPayload || {};
                    st.contextPayload.chatId = userChatId;
                });
            }
            DashboardLogger.log(`[PlannerSubAgent] Decomposed prompt into ${subTasks.length} sub-tasks: ${subTasks.map(t => `${t.targetAgent} (${t.taskId})`).join(", ")}`);

            // Execute sub-tasks with dependency resolution
            const manager = SubAgentManager.getInstance();
            const results = await manager.delegateTasksWithDependencies(subTasks);

            const totalStages = results.length;
            const successfulStages = results.filter(r => r.status === "SUCCESS").length;
            const isFullSuccess = successfulStages === totalStages;
            const isPartialSuccess = successfulStages > 0 && !isFullSuccess;

            let statusBadge = "";
            if (isFullSuccess) {
                statusBadge = `✅ **STATUS: SUCCESS (${successfulStages}/${totalStages} Stages Passed)**`;
            } else if (isPartialSuccess) {
                statusBadge = `⚠️ **STATUS: PARTIAL_SUCCESS (${successfulStages}/${totalStages} Stages Passed)**`;
            } else {
                statusBadge = `❌ **STATUS: FAILED (0/${totalStages} Stages Passed)**`;
            }

            const stageSections = results.map((res, idx) => {
                const agent = (res.targetAgent || "worker").toLowerCase();
                let title = `⚙️ **STAGE ${idx + 1}: ${agent.toUpperCase()}**`;
                if (agent === "research") title = `🔬 **STAGE ${idx + 1}: RESEARCH & INTELLIGENCE**`;
                if (agent === "browser") title = `🌐 **STAGE ${idx + 1}: DOCUMENTATION & LIVE BROWSING**`;
                if (agent === "coding") title = `💻 **STAGE ${idx + 1}: CODE GENERATION & VERIFICATION**`;
                if (agent === "memory") title = `🧠 **STAGE ${idx + 1}: MEMORY OPERATION**`;
                if (agent === "conversation") title = `💬 **STAGE ${idx + 1}: CONVERSATION CONTEXT**`;

                if (res.status === "SUCCESS") {
                    return `${title}\n${res.resultData}`;
                }
                return `${title}\n⚠️ [${agent.toUpperCase()} Task Failed]: ${res.error || "Incomplete"}\n${res.resultData || ""}`.trim();
            });

            const header = `📋 **OpenClaw Echo Multi-Agent Execution Plan**\n${statusBadge}\n\n`;
            const aggregatedReport = header + stageSections.join("\n\n═══════════════════════════════════════\n\n");

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: isFullSuccess || isPartialSuccess ? "SUCCESS" : "FAILED",
                toolName: "multi_agent_orchestrator",
                toolOutput: { totalStages, successfulStages, plan: smartPlan },
                verified: isFullSuccess || isPartialSuccess,
                verificationReason: `${successfulStages}/${totalStages} stages executed and verified successfully`,
                resultData: aggregatedReport,
                executionTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            console.error(`[PlannerSubAgent] Planning execution failed:`, error);
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                toolName: "multi_agent_orchestrator",
                error: error.message,
                resultData: `⚠️ [PlannerSubAgent Failed]: ${error.message}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }
}

