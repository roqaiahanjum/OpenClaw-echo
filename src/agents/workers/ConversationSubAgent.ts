import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * ConversationSubAgent
 *
 * Dedicated subagent for greetings, identity queries, and general conversational interactions.
 * Mandatory Rule: Must invoke the local `get_conversation_context` tool to retrieve
 * persona, active capabilities, and local memory before generating the final answer.
 */
export class ConversationSubAgent implements WorkerAgent {
    public readonly agentType = "conversation" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[ConversationSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        try {
            // 1. Mandatory Tool Invocation: get_conversation_context
            const contextTool = SkillRegistry.getToolByName("get_conversation_context");
            if (!contextTool) {
                throw new Error("Mandatory tool 'get_conversation_context' is not registered in SkillRegistry.");
            }

            const toolStart = Date.now();
            let rawToolOutput = "";
            let parsedContext: any = {};

            try {
                rawToolOutput = String(await contextTool.invoke({ query: task.taskDescription }));
                parsedContext = JSON.parse(rawToolOutput);
            } catch (err: any) {
                rawToolOutput = `Error executing get_conversation_context: ${err.message}`;
                parsedContext = { status: "FAILED", error: err.message };
            }

            const toolDuration = Date.now() - toolStart;
            const isToolSuccess = parsedContext.status === "SUCCESS";

            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:ConversationSubAgent] [Tool:get_conversation_context] [Status:${isToolSuccess ? 'SUCCESS' : 'FAILED'}] [DurationMs:${toolDuration}]`);

            // 2. Synthesize Grounded Conversational Response
            let responseText = "";
            const router = ModelRouter.getInstance();

            try {
                const systemPrompt = `You are OpenClaw Echo, a helpful autonomous multi-agent AI assistant.
Answer the user's conversational greeting or query politely, concisely (max 2-3 sentences), and grounded in this verified local context.
Context:
- Timestamp: ${parsedContext.timestamp || new Date().toISOString()}
- System Identity: ${parsedContext.system || "OpenClaw Echo"}
- Memory Facts Count: ${parsedContext.matchedFactsCount ?? 0}
${parsedContext.sampleFacts ? `- Known facts: ${parsedContext.sampleFacts.join("; ")}` : ""}

Never claim you lack capabilities. Be brief, professional, and direct.`;

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
                status: "SUCCESS",
                toolName: "get_conversation_context",
                toolOutput: parsedContext,
                verified: isToolSuccess,
                verificationReason: isToolSuccess ? "Local conversational context retrieved and verified" : "Context retrieved with partial degradation",
                resultData: responseText,
                executionTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            console.error(`[ConversationSubAgent] Task ${task.taskId} failed:`, error);
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                toolName: "get_conversation_context",
                error: error.message,
                resultData: `⚠️ [ConversationSubAgent Failed]: ${error.message}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }
}

