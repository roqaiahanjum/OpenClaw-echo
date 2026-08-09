// @ts-nocheck
import { ModelRouter } from "./router";
import { SkillRegistry } from "../skills/registry";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export interface SubAgentResult {
    subGoal: string;
    status: "SUCCESS" | "FAILED";
    summary: string;
    toolsExecuted: string[];
    scratchpad: string[];
}

export class SubAgentRunner {
    private static subAgentCounter = 0;

    public static async run(subTaskGoal: string): Promise<SubAgentResult> {
        const agentId = `SubAgent_${++SubAgentRunner.subAgentCounter}_${Date.now().toString(36).substring(4)}`;
        console.log(`[SubAgent] 🤖 Instantiating child sub-agent context: ${agentId} for goal: "${subTaskGoal}"`);

        const scratchpad: string[] = [];
        const toolsExecuted: string[] = [];
        const MAX_SUB_ITERATIONS = 3;

        scratchpad.push(`[Init] SubAgent ${agentId} spawned with clean scratchpad.`);

        const tools = SkillRegistry.getTools().filter(t => t.name !== "delegate_task");
        const router = ModelRouter.getInstance();

        try {
            const systemPrompt = `You are an isolated worker sub-agent (ID: ${agentId}).
Your single task goal: "${subTaskGoal}".
Work efficiently within a 3-step maximum iteration limit.
Available tools: ${tools.map(t => t.name).join(", ")}.
Output a concise summary when task completes.`;

            let messages = [
                new SystemMessage(systemPrompt),
                new HumanMessage(`Execute sub-task: ${subTaskGoal}`)
            ];

            let iteration = 0;
            let finalSummary = "";

            while (iteration < MAX_SUB_ITERATIONS) {
                iteration++;
                scratchpad.push(`[Iteration ${iteration}] Requesting tool decision from ModelRouter...`);

                const response: any = await router.invokeWithRetry(messages, "subagent", { tools });
                const toolCalls = (response as any).tool_calls || [];

                if (toolCalls.length > 0) {
                    const call = toolCalls[0];
                    const toolName = call.name;
                    const toolArgs = call.args;

                    toolsExecuted.push(toolName);
                    scratchpad.push(`[Exec] Selected Tool '${toolName}' with args: ${JSON.stringify(toolArgs)}`);

                    const toolObj = SkillRegistry.getToolByName(toolName);
                    let toolOutput = "";

                    if (toolObj) {
                        try {
                            toolOutput = await toolObj.invoke(toolArgs);
                            scratchpad.push(`[Output] Tool '${toolName}' succeeded: ${String(toolOutput).substring(0, 150)}`);
                        } catch (tErr: any) {
                            toolOutput = `Tool execution error: ${tErr.message}`;
                            scratchpad.push(`[Error] Tool '${toolName}' failed: ${tErr.message}`);
                        }
                    } else {
                        toolOutput = `Tool '${toolName}' not found in registry.`;
                    }

                    messages.push(response);
                    messages.push(new HumanMessage(`Tool ${toolName} output:\n${toolOutput}`));
                } else {
                    finalSummary = (response.content as string) || "Sub-task completed cleanly.";
                    scratchpad.push(`[Done] Sub-agent produced final response.`);
                    break;
                }
            }

            if (!finalSummary) {
                finalSummary = `Sub-task reached iteration limit (${MAX_SUB_ITERATIONS}). Output summary: ${scratchpad[scratchpad.length - 1]}`;
            }

            console.log(`[SubAgent] 🏁 ${agentId} destroyed context cleanly.`);

            return {
                subGoal: subTaskGoal,
                status: "SUCCESS",
                summary: finalSummary,
                toolsExecuted,
                scratchpad
            };
        } catch (err: any) {
            console.error(`[SubAgent] ${agentId} context error:`, err.message);
            return {
                subGoal: subTaskGoal,
                status: "FAILED",
                summary: `Sub-agent error: ${err.message}`,
                toolsExecuted,
                scratchpad
            };
        }
    }
}
