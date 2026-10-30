import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * MemorySubAgent
 *
 * Dedicated subagent for persistent memory storage, retrieval, and knowledge recall.
 * Uses real SQLite and semantic memory tools. Never fabricates memories.
 */
export class MemorySubAgent implements WorkerAgent {
    public readonly agentType = "memory" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[MemorySubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        const lower = task.taskDescription.toLowerCase();

        try {
            let toolName = "search_memory";
            let toolArgs: any = {};
            let isWriteOperation = false;

            // 1. Route to Write or Read Tool
            const isReadQuery = lower.startsWith("what") || lower.startsWith("which") || lower.startsWith("search") || lower.startsWith("recall") || lower.startsWith("find") || lower.includes("what did i save") || lower.includes("what have i saved");

            if (!isReadQuery && (lower.startsWith("remember") || lower.startsWith("save") || lower.startsWith("store") || lower.includes("remember that") || lower.includes("save this") || lower.includes("store this"))) {
                isWriteOperation = true;
                toolName = "save_knowledge";

                // Extract key and value
                let key = "user_preference";
                let value = task.taskDescription;

                const matchThat = task.taskDescription.match(/(?:remember|store|save)\s+(?:that\s+)?(.+)/i);
                if (matchThat && matchThat[1]) {
                    value = matchThat[1].trim();
                    // generate a clean slug key
                    key = value.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom_fact";
                }

                toolArgs = {
                    category: "user_memory",
                    key,
                    value,
                    confidence: 1.0
                };
            } else if (lower.includes("all facts") || lower.includes("what do you know") || lower.includes("list knowledge")) {
                toolName = "get_all_knowledge";
                toolArgs = {};
            } else if (lower.includes("stats") || lower.includes("how many facts")) {
                toolName = "get_memory_stats";
                toolArgs = {};
            } else {
                // Default to search_memory
                toolName = "search_memory";
                let query = task.taskDescription;
                const searchMatch = task.taskDescription.match(/(?:search for|search|recall|find|what did i save about|what did i save|what have i saved|tell me about|about)\s+(.+)/i);
                if (searchMatch && searchMatch[1]) {
                    query = searchMatch[1].trim();
                }
                // Strip punctuation and trailing question marks for cleaner SQLite substring matching
                query = query.replace(/[?!.,;]/g, "").trim();
                toolArgs = { query };
            }

            // 2. Execute Real Registered Memory Tool
            const targetTool = SkillRegistry.getToolByName(toolName);
            if (!targetTool) {
                throw new Error(`Memory tool '${toolName}' not found in SkillRegistry.`);
            }

            const toolStart = Date.now();
            const rawOutput = await targetTool.invoke(toolArgs);
            const toolDuration = Date.now() - toolStart;
            const outputStr = String(rawOutput);

            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:MemorySubAgent] [Tool:${toolName}] [Status:SUCCESS] [DurationMs:${toolDuration}]`);

            // 3. Grounded Synthesis
            let finalMessage = "";
            const router = ModelRouter.getInstance();

            try {
                const systemPrompt = `You are OpenClaw Echo's Memory SubAgent.
Report the memory operation result accurately to the user based ONLY on this verified tool output.
NEVER fabricate or guess facts not present in the tool output. If no memories were found, clearly inform the user.
Tool Name: ${toolName}
Tool Output:
${outputStr}`;

                const messages = [
                    new SystemMessage(systemPrompt),
                    new HumanMessage(task.taskDescription)
                ];

                const llmResponse: any = await router.invokeWithRetry(messages, "simple", { reqId: task.taskId });
                finalMessage = (llmResponse.content as string) || outputStr;
            } catch {
                finalMessage = outputStr;
            }

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "SUCCESS",
                toolName,
                toolOutput: outputStr,
                verified: true,
                verificationReason: isWriteOperation ? "Fact persisted to SQLite storage" : "Memory queried from persistent database",
                resultData: finalMessage,
                executionTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            console.error(`[MemorySubAgent] Task ${task.taskId} failed:`, error);
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                toolName: "memory_tool",
                error: error.message,
                resultData: `⚠️ [MemorySubAgent Failed]: ${error.message}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }
}
