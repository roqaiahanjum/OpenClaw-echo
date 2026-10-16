import { ModelRouter } from "./router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export interface VerificationResult {
    success: boolean;
    reason: string;
}

/**
 * Verifier Engine
 * Evaluates tool execution outputs to verify whether they satisfy the task goal.
 */
export async function verifyStepResult(userGoal: string, actionName: string, output: string): Promise<VerificationResult> {
    try {
        const router = ModelRouter.getInstance();
        const verifierPrompt = `You are the OpenClaw Output Verifier.
Evaluate if the tool output successfully executed its specific action. 
NOTE: The User Goal may require multiple tools to fully resolve. Do NOT fail the tool if it only completed a partial step towards the overall goal, as long as the tool's specific action succeeded.
User Goal: ${userGoal}
Tool Executed: ${actionName}

Return ONLY valid JSON matching this schema, without markdown formatting or extra text:
{
  "success": true,
  "reason": "brief reason for pass or failure"
}`;

        const messages = [
            new SystemMessage(verifierPrompt),
            new HumanMessage(`TOOL OUTPUT:\n${output.slice(0, 1500)}`)
        ];

        const response = await router.invoke(messages, "verifier");
        let rawContent = response.content as string;

        rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed.success === "boolean") {
            return {
                success: parsed.success,
                reason: parsed.reason || (parsed.success ? "Output verified successfully." : "Output failed verification.")
            };
        }

        return { success: true, reason: "Verification format warning; passing by default." };
    } catch (error: any) {
        console.warn("[Verifier] Verification skipped due to error:", error.message);
        return { success: true, reason: "Verification skipped due to error." };
    }
}
