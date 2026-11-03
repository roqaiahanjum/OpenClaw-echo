/**
 * OpenClaw Echo — Production Tool Result Honesty Guard
 * 
 * Enforces strict, verifiable truthfulness between agent tool executions
 * and final user-facing responses.
 * 
 * Prevents LLM-generated success claims when:
 * 1. No tool was called for an action request.
 * 2. The tool failed or threw an error.
 * 3. Required credentials were missing.
 * 4. The external provider did not confirm acceptance.
 * 5. The operation timed out.
 */

export type ToolExecutionStatus = "success" | "failure" | "unavailable" | "timeout" | "unverified";

export interface ToolExecutionContract {
    status: ToolExecutionStatus;
    tool: string;
    message: string;
    data?: any;
    error?: string;
    providerEvidence?: {
        messageId?: string;
        accepted?: string[];
        rejected?: string[];
        httpStatus?: number;
        exitCode?: number;
        [key: string]: any;
    };
}

/**
 * Normalizes raw tool outputs into a machine-readable ToolExecutionContract.
 */
export function normalizeToolResult(toolName: string, rawOutput: any, toolArgs?: any): ToolExecutionContract {
    const text = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput || "");
    const lower = text.toLowerCase();

    // 1. Missing credentials / Unavailable
    if (
        lower.includes("not configured in environment") ||
        lower.includes("api key is not configured") ||
        lower.includes("credentials not configured") ||
        lower.includes("is currently disabled")
    ) {
        return {
            status: "unavailable",
            tool: toolName,
            message: text,
            error: "Required credentials or service is not configured in environment."
        };
    }

    // 2. Timeouts
    if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("etimedout")) {
        return {
            status: "timeout",
            tool: toolName,
            message: text,
            error: "Tool operation timed out."
        };
    }

    // 3. Email Tool Specific Contract
    if (toolName === "send_email_report") {
        if (text.includes("Email sent successfully to") && text.includes("MessageId:")) {
            const idMatch = text.match(/MessageId:\s*([^\s.]+)/);
            return {
                status: "success",
                tool: toolName,
                message: text,
                providerEvidence: {
                    messageId: idMatch ? idMatch[1] : undefined,
                    accepted: toolArgs?.to ? [toolArgs.to] : []
                }
            };
        }
        return {
            status: "failure",
            tool: toolName,
            message: text,
            error: text
        };
    }

    // 4. General Failures & Safety Errors
    if (
        lower.includes("error") ||
        lower.includes("failed") ||
        lower.includes("safety violation") ||
        lower.includes("safety error") ||
        lower.includes("rejected") ||
        lower.includes("exception") ||
        lower.includes("unsupported")
    ) {
        return {
            status: "failure",
            tool: toolName,
            message: text,
            error: text
        };
    }

    // 5. Success
    return {
        status: "success",
        tool: toolName,
        message: text,
        data: rawOutput
    };
}

/**
 * Patterns in user prompts indicating an external, state-changing action.
 */
const ACTION_REQUEST_PATTERNS = [
    { type: "email", pattern: /\b(?:send\s+(?:an?\s+|the\s+)?email|email\s+to|mail\s+to)\b/i, requiredTool: "send_email_report" },
    { type: "code_execution", pattern: /\b(?:run\s+(?:the\s+)?(?:code|script)|execute\s+(?:the\s+)?(?:code|script))\b/i, requiredTool: "run_sandbox_code" },
    { type: "file_write", pattern: /\b(?:write\s+file|create\s+file|save\s+(?:it\s+)?to\s+file)\b/i, requiredTool: "write_sandbox_file" },
    { type: "goal", pattern: /\b(?:create\s+goal|add\s+goal|update\s+goal)\b/i, requiredTool: "manage_project_goals" },
    { type: "schedule", pattern: /\b(?:schedule\s+task|set\s+timer|cron)\b/i, requiredTool: "manage_scheduled_tasks" }
];

/**
 * Validates that an LLM-generated response does not claim success for an action
 * that was either never executed or failed.
 */
export function validateResponseHonesty(params: {
    userInput: string;
    executedToolCalls: Array<{ name: string; args: any; output: string }>;
    llmResponse: string;
}): { honest: boolean; sanitizedResponse: string; reason?: string } {
    const { userInput, executedToolCalls, llmResponse } = params;
    const lowerInput = userInput.toLowerCase();
    const lowerResponse = llmResponse.toLowerCase();

    for (const action of ACTION_REQUEST_PATTERNS) {
        if (action.pattern.test(lowerInput)) {
            const toolCall = executedToolCalls.find(tc => tc.name === action.requiredTool);

            // Case A: Action was requested, but corresponding tool was NEVER called
            if (!toolCall) {
                const claimsSuccess = 
                    lowerResponse.includes("sent the email") || 
                    lowerResponse.includes("email has been sent") ||
                    lowerResponse.includes("email sent successfully") ||
                    lowerResponse.includes("executed the script") ||
                    lowerResponse.includes("created the file") ||
                    lowerResponse.includes("saved the file") ||
                    lowerResponse.includes("scheduled the task") ||
                    lowerResponse.includes("created the goal");

                if (claimsSuccess) {
                    return {
                        honest: false,
                        sanitizedResponse: `⚠️ Action Unverified: The requested ${action.type} action could not be completed because the required tool '${action.requiredTool}' was not executed by the agent pipeline. No external action took place.`,
                        reason: `Unexecuted action: LLM claimed success for ${action.type} without calling ${action.requiredTool}`
                    };
                }
            }

            // Case B: Tool was called, but failed or was rejected
            if (toolCall) {
                const contract = normalizeToolResult(toolCall.name, toolCall.output, toolCall.args);
                if (contract.status !== "success") {
                    const claimsSuccess = 
                        lowerResponse.includes("sent successfully") || 
                        lowerResponse.includes("email has been sent") ||
                        lowerResponse.includes("delivered to");

                    if (claimsSuccess) {
                        return {
                            honest: false,
                            sanitizedResponse: `⚠️ Action Failed: The operation '${toolCall.name}' did not succeed. Result: ${contract.message}`,
                            reason: `False success claim: Tool '${toolCall.name}' status is '${contract.status}', but response claimed success`
                        };
                    }
                }
            }
        }
    }

    return {
        honest: true,
        sanitizedResponse: llmResponse
    };
}

