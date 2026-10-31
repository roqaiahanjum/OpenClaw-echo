import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * MemorySubAgent
 *
 * Dedicated subagent for persistent memory storage, retrieval, and knowledge recall.
 * Uses real SQLite and semantic memory tools. Never fabricates memories.
 * Strictly respects multi-user isolation via chatId.
 */
export class MemorySubAgent implements WorkerAgent {
    public readonly agentType = "memory" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[MemorySubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        const lower = task.taskDescription.toLowerCase();
        const chatId = task.contextPayload?.chatId ? String(task.contextPayload.chatId) : "default";

        try {
            let toolName = "search_memory";
            let toolArgs: any = {};
            let isWriteOperation = false;

            // 1. Identify Read vs Write Operations
            const isNameQuery = /\b(?:what(?:'s|\s+is)\s+my\s+name|who\s+am\s+i|do\s+you\s+(?:know|remember)\s+my\s+name|tell\s+me\s+my\s+name|what\s+is\s+my\s+identity)\b/i.test(lower);
            const isReadQuery = isNameQuery ||
                /\b(?:what\s+did\s+i\s+save|what\s+do\s+you\s+remember|what\s+have\s+i\s+saved|what\s+is\s+saved|search|recall|find|list\s+knowledge|all\s+facts|memory\s+stats|how\s+many\s+facts)\b/i.test(lower) ||
                lower.startsWith("what") || lower.startsWith("which") || lower.startsWith("search") || lower.startsWith("recall") || lower.startsWith("find");

            const nameMatch = task.taskDescription.match(
                /(?:remember\s+(?:that\s+)?my\s+name\s+is|my\s+name\s+is|call\s+me|i\s+am)\s+([A-Za-z0-9\s'-]+?)(?:\.|\!|,|\s+please|\s+remember|\s+save|\s+and|$)/i
            );
            const hasRememberDirective = /\b(?:remember|save|store|memorize|keep\s+in\s+mind|note\s+down)\b/i.test(lower);

            if (!isReadQuery && (hasRememberDirective || nameMatch || lower.includes("remember") || lower.includes("save") || lower.includes("store"))) {
                isWriteOperation = true;
                toolName = "save_knowledge";

                let category = "user_memory";
                let key = "custom_fact";
                let value = task.taskDescription;

                if (nameMatch && nameMatch[1] && !["a", "the", "building", "working", "going", "here", "ready"].includes(nameMatch[1].toLowerCase().trim())) {
                    category = "user_profile";
                    key = "user_name";
                    value = nameMatch[1].trim();
                } else {
                    const matchThat = task.taskDescription.match(/(?:remember|store|save|memorize)\s+(?:that\s+)?(?:my\s+)?(.+)/i);
                    if (matchThat && matchThat[1]) {
                        value = matchThat[1].trim();
                        key = value.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "custom_fact";
                    }
                }

                toolArgs = {
                    category,
                    key,
                    value,
                    confidence: 1.0,
                    chatId
                };
            } else if (lower.includes("all facts") || lower.includes("what do you know") || lower.includes("list knowledge")) {
                toolName = "get_all_knowledge";
                toolArgs = { chatId };
            } else if (lower.includes("stats") || lower.includes("how many facts")) {
                toolName = "get_memory_stats";
                toolArgs = {};
            } else if (isNameQuery) {
                toolName = "search_memory";
                toolArgs = { query: "user_name", chatId };
            } else {
                toolName = "search_memory";
                let query = task.taskDescription;
                const searchMatch = task.taskDescription.match(/(?:search for|search|recall|find|what did i save about|what did i save|what have i saved|tell me about|about)\s+(.+)/i);
                if (searchMatch && searchMatch[1]) {
                    query = searchMatch[1].trim();
                }
                query = query.replace(/[?!.,;]/g, "").trim();
                toolArgs = { query, chatId };
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

            // Check if persistence operation failed
            if (isWriteOperation && (outputStr.startsWith("Failed") || outputStr.startsWith("Error") || outputStr.includes("Save Fact Error"))) {
                return {
                    taskId: task.taskId,
                    targetAgent: this.agentType,
                    status: "FAILED",
                    toolName,
                    toolOutput: outputStr,
                    verified: false,
                    error: outputStr,
                    resultData: `⚠️ [Memory Persistence Failed]: Unable to save fact to persistent memory. ${outputStr}`,
                    executionTimeMs: Date.now() - startTime
                };
            }

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
