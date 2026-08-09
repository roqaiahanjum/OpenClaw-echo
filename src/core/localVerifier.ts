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

    // 3. Fallback for tools without deterministic rules yet
    return {
        status: "uncertain",
        reason: `No local deterministic verifier rule for tool '${toolName}'. Falling back to Gemini verifier.`
    };
}
