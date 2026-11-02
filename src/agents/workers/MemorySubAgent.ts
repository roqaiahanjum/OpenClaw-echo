import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { FactExtractionEngine } from "../../memory/FactExtractionEngine";

/**
 * MemorySubAgent
 *
 * Dedicated subagent for persistent memory storage, retrieval, and knowledge recall.
 * Uses real SQLite/Turso and semantic memory tools. Never fabricates memories.
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
            const isOffsetPriorHistory = /\b(?:the\s+one\s+before|before\s+that|prior\s+to\s+that|one\s+before\s+it|question\s+before)\b/i.test(lower);
            const isQuestionHistory = isOffsetPriorHistory || /\b(?:(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five)?\s*questions?|what\s+(?:was|were)\s+(?:my|the)\s+(?:last|previous|recent)\s+(?:\d+|one|two|three|four|five)?\s*questions?|what\s+did\s+i\s+(?:last|just|previously)\s*(?:ask|inquire)|which\s+(?:two\s+|three\s+)?questions?\s+(?:have\s+i\s+asked|did\s+i\s+ask)|list\s+(?:everything|all)\s+i\s+asked)\b/i.test(lower);
            const isMessageHistory = !isQuestionHistory && /\b(?:(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five)?\s*(?:messages?|chats?|turns?|texts?)|what\s+did\s+i\s+(?:just\s+)?say|conversation\s+history)\b/i.test(lower);

            const isReadQuery = isNameQuery || isQuestionHistory || isMessageHistory ||
                /\b(?:what\s+did\s+i\s+save|what\s+do\s+you\s+remember|what\s+have\s+i\s+saved|what\s+is\s+saved|search|recall|find|list\s+knowledge|all\s+facts|memory\s+stats|how\s+many\s+facts)\b/i.test(lower) ||
                /^(?:what|which|where|who|when|how|do\s+you|can\s+you|tell\s+me|search|recall|find)\b/i.test(lower) ||
                lower.endsWith("?");

            const hasRememberDirective = /\b(?:remember|save|store|memorize|keep\s+in\s+mind|note\s+down)\b/i.test(lower);
            const isFactStatement = !isReadQuery && /^(?:my\s+[a-z0-9_\-\s]+?\s+is|i\s+am|i\s+study|i\s+work|i\s+prefer|our\s+[a-z0-9_\-\s]+?\s+is)\b/i.test(lower);

            if (!isReadQuery && (hasRememberDirective || isFactStatement || lower.includes("remember") || lower.includes("save") || lower.includes("store"))) {
                isWriteOperation = true;
                toolName = "save_knowledge";

                // Extract structured fact with canonical key using FactExtractionEngine
                const engine = FactExtractionEngine.getInstance();
                const extracted = await engine.extractFact(task.taskDescription);

                toolArgs = {
                    category: extracted.category,
                    key: extracted.key,
                    value: extracted.value,
                    confidence: extracted.confidence,
                    chatId
                };
            } else if (isQuestionHistory) {
                toolName = "get_conversation_history";
                let limit = 1;
                let offset = 0;

                // Handle prior / offset questions ("and the one before it?", "what about before that?", "the one prior to that")
                if (isOffsetPriorHistory) {
                    limit = 1;
                    offset = 1;
                } else {
                    const digitMatch = lower.match(/\b(?:last|previous|recent|earlier)\s+(\d+)\s*questions?\b/i) ||
                                       lower.match(/\b(?:which|list)\s+(\d+)\s*questions?\b/i);
                    if (digitMatch) {
                        limit = parseInt(digitMatch[1], 10);
                    } else {
                        const wordMap: Record<string, number> = {
                            one: 1, two: 2, three: 3, four: 4, five: 5,
                            six: 6, seven: 7, eight: 8, nine: 9, ten: 10
                        };
                        const wordMatch = lower.match(/\b(?:last|previous|recent|earlier|which)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s*questions?\b/i);
                        if (wordMatch) {
                            limit = wordMap[wordMatch[1].toLowerCase()] || 2;
                        } else if (/\b(?:everything|all)\s+i\s+asked\b/i.test(lower) || /\bquestions\s+(?:have\s+i\s+asked|so\s+far)\b/i.test(lower)) {
                            limit = 20;
                        } else if (/\b(?:questions|recent\s+questions)\b/i.test(lower) && !/\b(?:last\s+question|previous\s+question)\b/i.test(lower)) {
                            limit = 5;
                        }
                    }
                }
                toolArgs = { chatId, filter: "questions_only", limit, offset };
            } else if (isMessageHistory) {
                toolName = "get_conversation_history";
                let limit = 5;
                const digitMatch = lower.match(/\b(?:last|previous|recent|earlier)\s+(\d+)\s*(?:messages?|chats?|turns?|texts?)\b/i);
                if (digitMatch) {
                    limit = parseInt(digitMatch[1], 10);
                } else {
                    const wordMap: Record<string, number> = {
                        one: 1, two: 2, three: 3, four: 4, five: 5,
                        six: 6, seven: 7, eight: 8, nine: 9, ten: 10
                    };
                    const wordMatch = lower.match(/\b(?:last|previous|recent|earlier)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:messages?|chats?|turns?|texts?)\b/i);
                    if (wordMatch) {
                        limit = wordMap[wordMatch[1].toLowerCase()] || 2;
                    }
                }
                toolArgs = { chatId, filter: "all_messages", limit };
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

            // Handoff to ResearchSubAgent if memory search returned no results and query is not an explicit personal memory storage command
            const isMemoryEmpty = !outputStr || outputStr.trim() === "" || outputStr.includes("No matching") || outputStr.includes("No memory found") || outputStr.includes("No facts found") || outputStr.trim() === "[]";
            if (!isWriteOperation && toolName === "search_memory" && isMemoryEmpty) {
                const isGeneralOrExternalQuery = !/\b(my|i\s+am|my\s+name|my\s+project|remember\s+that|save\s+fact)\b/i.test(task.taskDescription);
                if (isGeneralOrExternalQuery) {
                    console.log(`[MemorySubAgent] Memory returned empty result for general query: "${task.taskDescription}". Handing off to ResearchSubAgent...`);
                    const researchWorker = (await import("../SubAgentManager")).SubAgentManager.getInstance().getWorker("research");
                    if (researchWorker) {
                        return await researchWorker.execute({
                            ...task,
                            targetAgent: "research"
                        });
                    }
                }
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
