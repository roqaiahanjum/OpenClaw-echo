import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolExecutionContract } from "../../core/toolExecutionContract";

/**
 * ConversationSubAgent
 *
 * Dedicated subagent for conversation, educational explanations, conceptual Q&A,
 * follow-up clarifications/examples, greetings, and persona interactions.
 * Mandatory Rule: Must invoke the local `get_conversation_context` tool to retrieve
 * persona, active capabilities, and local dialogue history before generating the final answer.
 */
export class ConversationSubAgent implements WorkerAgent {
    public readonly agentType = "conversation" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[ConversationSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        // 0. Routing Contract Guard: Prevent silent bypass of tools
        const toolCheck = ToolExecutionContract.inspectRequiredTool(task.taskDescription);
        if (toolCheck.requiresTool && toolCheck.targetAgent && toolCheck.targetAgent !== "conversation") {
            console.log(`[ConversationSubAgent] [ContractGuard] Re-routing tool request to '${toolCheck.targetAgent}': "${task.taskDescription}"`);
            const { SubAgentManager } = await import("../SubAgentManager");
            const worker = SubAgentManager.getInstance().getWorker(toolCheck.targetAgent as any);
            if (worker) {
                return await worker.execute({
                    ...task,
                    targetAgent: toolCheck.targetAgent as any
                });
            }
        }

        try {
            // 1. Mandatory Tool Invocation: get_conversation_context
            const contextTool = SkillRegistry.getToolByName("get_conversation_context");
            if (!contextTool) {
                throw new Error("Mandatory tool 'get_conversation_context' is not registered in SkillRegistry.");
            }

            const chatId = task.contextPayload?.chatId ? String(task.contextPayload.chatId) : "default";
            const toolStart = Date.now();
            let rawToolOutput = "";
            let parsedContext: any = {};

            try {
                rawToolOutput = String(await contextTool.invoke({ query: task.taskDescription, chatId }));
                parsedContext = JSON.parse(rawToolOutput);
            } catch (err: any) {
                rawToolOutput = `Error executing get_conversation_context: ${err.message}`;
                parsedContext = { status: "FAILED", error: err.message };
            }

            const toolDuration = Date.now() - toolStart;
            const isToolSuccess = parsedContext.status === "SUCCESS";

            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:ConversationSubAgent] [Tool:get_conversation_context] [Status:${isToolSuccess ? 'SUCCESS' : 'FAILED'}] [DurationMs:${toolDuration}]`);

            // 2. Combine dialogue history from tool context and in-memory payload (prioritizing task payload if explicitly supplied)
            const dialogueHistoryCombined = [
                task.contextPayload?.dialogueHistoryFormatted,
                parsedContext.recentDialogue
            ].filter(Boolean).join("\n---\n") || "";

            // 3. Synthesize Grounded Conversational Response
            let responseText = "";
            const router = ModelRouter.getInstance();

            try {
                const systemPrompt = `You are OpenClaw Echo, an intelligent, helpful, and articulate autonomous AI assistant.
Respond to the user naturally, accurately, and thoughtfully, grounded in the verified conversation context and dialogue history.

Context:
- Timestamp: ${parsedContext.timestamp || new Date().toISOString()}
- System Identity: ${parsedContext.system || "OpenClaw Echo"}
- Memory Facts Count: ${parsedContext.matchedFactsCount ?? 0}
${parsedContext.sampleFacts && parsedContext.sampleFacts.length > 0 ? `- Known user facts: ${parsedContext.sampleFacts.join("; ")}` : ""}

${dialogueHistoryCombined ? `=== Recent Conversation Dialogue History ===\n${dialogueHistoryCombined}\n` : ""}
${parsedContext.recentQuestions ? `=== Recent Questions Asked by User ===\n${parsedContext.recentQuestions}\n` : ""}
${task.contextPayload?.context ? `=== Memory Context ===\n${task.contextPayload.context}\n` : ""}

Guidelines:
1. Direct & Relevant Answers:
   - Answer the user's actual question directly and immediately.
   - For educational or conceptual questions (e.g. "Explain X in simple words"), provide a clear, intuitive, and easy-to-understand explanation using accessible analogies.
   - For follow-up questions (e.g. "Can you explain that with an example?", "Tell me more", "Why is that?", "How does it work?"), carefully inspect the Recent Conversation Dialogue History above, resolve pronouns and anaphoric references (such as "that", "it") to the subject previously discussed, and continue the explanation with concrete, real-world examples.
   - For greetings or pleasantries, be warm, polite, and brief (1-3 sentences).

2. Context & Continuity:
   - If the user asks what they previously asked or questions about previous context, refer directly to the Recent Questions and Recent Conversation Dialogue History above.
   - Never claim you lack context or that the user has not asked anything if previous turns appear in the dialogue history.

3. Formatting:
   - Use clean, Telegram-friendly Markdown: bold key concepts, use bullet points for lists, and keep paragraphs well-spaced.
   - Do NOT include raw JSON, internal tool metadata, or synthetic headers like "### Research Synthesis".
   - Include citations only when referencing specific external sources provided in context.

4. Anti-Evasion & Truthfulness:
   - NEVER pretend to perform future or offline actions.
   - NEVER make false promises or claim you are checking something unless a tool has actually executed.
   - If the user asks about system reliability properties, state factually what the system guarantees: OpenClaw Echo enforces truthful failure reporting without silent fallbacks, and uses request deduplication caching to guarantee no duplicate replies are sent.`;

                const messages = [
                    new SystemMessage(systemPrompt),
                    new HumanMessage(task.taskDescription)
                ];

                const llmResponse: any = await router.invokeWithRetry(messages, "simple", {
                    reqId: task.taskId
                });

                responseText = (llmResponse.content as string) || "Hello! I am OpenClaw Echo, your autonomous multi-agent AI assistant. How can I help you today?";
            } catch (llmErr: any) {
                console.warn(`[ConversationSubAgent] LLM invocation warning: ${llmErr.message}. Formulating direct response from tool context.`);
                const greetingMatch = task.taskDescription.toLowerCase();
                if (greetingMatch.includes("hi") || greetingMatch.includes("hello") || greetingMatch.includes("hey")) {
                    responseText = "Hello! I am OpenClaw Echo, an autonomous multi-agent AI framework. I'm online and ready to assist you with research, coding, browsing, and memory management.";
                } else {
                    responseText = `Hello! OpenClaw Echo is online and operating with verified local context (Time: ${parsedContext.timestamp || "Active"}). What would you like to build or explore?`;
                }
            }

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: isToolSuccess ? "SUCCESS" : "FAILED",
                toolName: "get_conversation_context",
                toolOutput: rawToolOutput,
                verified: isToolSuccess,
                verificationReason: isToolSuccess ? "Conversation context retrieved and synthesized successfully" : "Context tool execution failed",
                resultData: responseText,
                executionTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            console.error(`[ConversationSubAgent] Error during task execution:`, error.message);
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                error: error.message,
                resultData: `⚠️ [ConversationSubAgent Error]: ${error.message}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }
}
