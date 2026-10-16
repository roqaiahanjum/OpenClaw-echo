import { ModelRouter } from "./router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export type RecoveryStrategy = "retry_same" | "modify_args" | "alternative_tool" | "replan" | "abort";

export interface RecoveryDecision {
    strategy: RecoveryStrategy;
    reason: string;
    newToolName?: string;
    newArgs?: Record<string, any>;
}

export interface RecoveryInput {
    userGoal: string;
    toolName: string;
    toolArgs: Record<string, any>;
    output: string;
    failureReason: string;
    availableTools: string[];
    attemptCount: number;
}

/**
 * Self-Healing Recovery Engine
 * Analyzes failed tool steps and determines an appropriate recovery decision.
 */
export async function determineRecoveryStrategy(input: RecoveryInput): Promise<RecoveryDecision> {
    if (input.attemptCount >= 2) {
        return {
            strategy: "abort",
            reason: `Exceeded maximum step recovery attempts (${input.attemptCount}).`
        };
    }

    try {
        const { SkillRegistry } = await import("../skills/registry");
        const availableToolDetails = input.availableTools.map(tName => {
            const tool = SkillRegistry.getToolByName(tName);
            if (tool && tool.schema) {
                // Return schema shape if possible, or just the description
                return `- ${tName}: ${tool.description}`;
            }
            return `- ${tName}`;
        }).join("\n");

        const router = ModelRouter.getInstance();
        const recoveryPrompt = `You are the OpenClaw Self-Healing Recovery Engine.
A tool execution failed verification. Analyze the failure and recommend a recovery strategy.

User Goal: ${input.userGoal}
Failed Tool: ${input.toolName}
Failed Tool Args: ${JSON.stringify(input.toolArgs)}
Failure Reason: ${input.failureReason}
Available Tools:
${availableToolDetails}

Choose ONE strategy from:
1. "modify_args": Adjust arguments for the same tool.
2. "alternative_tool": Pick a different tool from Available Tools.
3. "retry_same": Retry the same tool with exact same arguments.
4. "replan": Ask the agent to re-plan its approach.
5. "abort": Stop attempting recovery.

IMPORTANT: If choosing "alternative_tool" or "modify_args", you MUST provide valid arguments matching the tool's schema. Do NOT invent or omit required fields (e.g. do not add 'content' to run_sandbox_code which only takes 'fileName').

Return ONLY valid JSON matching this schema, without markdown formatting or extra text:
{
  "strategy": "modify_args",
  "reason": "explanation of decision",
  "newToolName": "tool_name or null",
  "newArgs": { "param": "value" }
}`;

        const messages = [
            new SystemMessage(recoveryPrompt),
            new HumanMessage(`FAILED TOOL OUTPUT:\n${input.output.slice(0, 1500)}`)
        ];

        const response = await router.invoke(messages, "recovery");
        let rawContent = response.content as string;
        rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

        const parsed = JSON.parse(rawContent);
        if (parsed && parsed.strategy) {
            return {
                strategy: parsed.strategy as RecoveryStrategy,
                reason: parsed.reason || "Recovery strategy selected.",
                newToolName: parsed.newToolName || undefined,
                newArgs: parsed.newArgs || undefined
            };
        }

        return { strategy: "modify_args", reason: "Fallback recovery decision." };
    } catch (error: any) {
        console.warn("[Recovery] Recovery decision skipped:", error.message);
        return { strategy: "abort", reason: `Recovery skipped due to error: ${error.message}` };
    }
}
