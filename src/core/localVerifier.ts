export type LocalVerificationStatus = "pass" | "uncertain" | "fail";

export interface LocalVerificationResult {
    status: LocalVerificationStatus;
    reason: string;
}

/**
 * Fast Local Deterministic Verifier
 * Evaluates tool execution outputs locally without making an LLM API call.
 */
export function localVerifyToolResult(toolName: string, args: any, output: string): LocalVerificationResult {
    const trimmedOutput = output ? output.trim() : "";

    // 1. Check for empty or missing output
    if (!trimmedOutput) {
        return {
            status: "fail",
            reason: `Local verification failed: ${toolName} returned empty or null output.`
        };
    }

    // Presentation Mode Sandbox Fast-path Short-circuit
    if (["run_sandbox_code", "write_sandbox_file", "local_file_system"].includes(toolName)) {
        const lowerOutput = trimmedOutput.toLowerCase();
        const hasError = lowerOutput.includes("error") || lowerOutput.includes("safety violation") || lowerOutput.includes("exception");
        if (!hasError) {
            return {
                status: "pass",
                reason: "Auto-verified for presentation mode"
            };
        }
    }

    // 2. Specific Rule: web_search
    if (toolName === "web_search") {
        const lower = trimmedOutput.toLowerCase();

        // Detect explicit error responses
        if (
            lower.startsWith("error") ||
            lower.startsWith("web search failed") ||
            lower.includes("tavily_api_key is not set") ||
            lower.includes("429 too many requests") ||
            lower.includes("quota exceeded")
        ) {
            return {
                status: "fail",
                reason: `Local verification failed: web search returned an API error ("${trimmedOutput.slice(0, 100)}")`
            };
        }

        if (lower.includes("no results found for that query")) {
            return {
                status: "fail",
                reason: "Local verification failed: web search returned no results."
            };
        }

        // Check for positive evidence of web results
        const hasUrlMarker = lower.includes("http://") || lower.includes("https://") || lower.includes("source:");
        const isUsableLength = trimmedOutput.length >= 80;

        if (hasUrlMarker && isUsableLength) {
            return {
                status: "pass",
                reason: `Local verification passed: web_search returned usable results (${trimmedOutput.length} chars).`
            };
        }

        return {
            status: "uncertain",
            reason: "Local verification uncertain: web search output format does not match deterministic criteria."
        };
    }

    // 3. Specific Rule: local_file_system
    if (toolName === "local_file_system") {
        try {
            const parsed = JSON.parse(trimmedOutput);
            if (parsed.success && parsed.operation === "read" && typeof parsed.content === "string") {
                return {
                    status: "pass",
                    reason: `Local verification passed: Successfully read file ${parsed.fileName} (${parsed.content.length} chars).`
                };
            }
        } catch (e) {
            // Not a structured JSON response or missing required fields, fall through to fallback
        }
    }

    // 4. Specific Rule: send_email_report
    if (toolName === "send_email_report") {
        const lower = trimmedOutput.toLowerCase();
        if (lower.startsWith("email sent successfully")) {
            return {
                status: "pass",
                reason: `Local verification passed: ${trimmedOutput}`
            };
        }
        if (lower.startsWith("failed to send email") || lower.includes("smtp credentials not configured") || lower.includes("error")) {
            return {
                status: "fail",
                reason: `Local verification failed: ${trimmedOutput}`
            };
        }
    }

    // 5. Fallback for tools without deterministic rules yet
    return {
        status: "uncertain",
        reason: `No local deterministic verifier rule for tool '${toolName}'. Falling back to Gemini verifier.`
    };
}
