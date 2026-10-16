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

    // Presentation Mode Sandbox & Local File System Verification
    if (["run_sandbox_code", "write_sandbox_file", "local_file_system"].includes(toolName)) {
        const lowerOutput = trimmedOutput.toLowerCase();
        const hasError = lowerOutput.includes("error") || lowerOutput.includes("safety violation") || lowerOutput.includes("exception") || lowerOutput.includes("enoent");
        if (hasError) {
            return {
                status: "fail",
                reason: `Local verification failed: ${toolName} output reported an error ("${trimmedOutput.slice(0, 100)}")`
            };
        }
        return {
            status: "pass",
            reason: "Auto-verified: Operation completed without errors"
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

    // 5. Specific Rule: scrape_website
    if (toolName === "scrape_website") {
        const lower = trimmedOutput.toLowerCase();
        if (lower.startsWith("failed to scrape") || lower.startsWith("safety error")) {
            return {
                status: "fail",
                reason: `Local verification failed: ${trimmedOutput}`
            };
        }
        if (lower.startsWith("scraped content from") && trimmedOutput.length >= 20) {
            return {
                status: "pass",
                reason: `Local verification passed: Successfully scraped website content (${trimmedOutput.length} chars).`
            };
        }
    }

    // 6. Specific Rule: manage_project_goals
    if (toolName === "manage_project_goals") {
        const lower = trimmedOutput.toLowerCase();
        if (lower.startsWith("goal operation failed") || lower.includes("error:")) {
            return {
                status: "fail",
                reason: `Local verification failed: ${trimmedOutput.slice(0, 150)}`
            };
        }
        // Meaningful evidence: checks for operation success marker or valid JSON array/object structure
        const hasProcessedMarker = lower.includes("goal operation '") && lower.includes("processed");
        const hasGoalArray = lower.includes("goals summary:") && trimmedOutput.includes("[") && trimmedOutput.includes("]");
        if (hasProcessedMarker || hasGoalArray) {
            return {
                status: "pass",
                reason: `Local verification passed: Project goals operation verified with structured goals summary.`
            };
        }
    }

    // 7. Specific Rule: manage_git_repository
    if (toolName === "manage_git_repository") {
        const lower = trimmedOutput.toLowerCase();
        if (
            lower.startsWith("git operation failed") || 
            lower.startsWith("unsupported git action") ||
            lower.includes("fatal:") || 
            lower.includes("not a git repository")
        ) {
            return {
                status: "fail",
                reason: `Local verification failed: ${trimmedOutput.slice(0, 150)}`
            };
        }
        // Meaningful evidence: Git command header + legitimate git output patterns
        const hasHeader = trimmedOutput.startsWith("Git command [");
        const hasLegitGitOutput = 
            lower.includes("on branch") || 
            lower.includes("changes not staged") ||
            lower.includes("nothing to commit") || 
            lower.includes("feature/") || 
            lower.includes("main") || 
            lower.includes("master") ||
            /^[0-9a-f]{7,40}\s+/m.test(trimmedOutput) || // commit hash in git log
            lower.includes("files changed") || 
            lower.includes("insertions") || 
            lower.includes("(no output from git command)") ||
            /^\s*(?:[MADRCU?!\s]{1,2})\s+\S+/m.test(trimmedOutput); // short git status: M file, ?? file, etc.

        if (hasHeader && hasLegitGitOutput) {
            return {
                status: "pass",
                reason: `Local verification passed: Git command completed with validated git status/log/diff content.`
            };
        }
    }

    // 8. Specific Rule: get_memory_stats
    if (toolName === "get_memory_stats") {
        const lower = trimmedOutput.toLowerCase();
        if (lower.startsWith("error fetching memory stats") || lower.includes("failed")) {
            return {
                status: "fail",
                reason: `Local verification failed: ${trimmedOutput.slice(0, 150)}`
            };
        }
        // Meaningful evidence: Header + all 4 memory layers present with numerical values
        const hasHeader = trimmedOutput.includes("Memory System Statistics:");
        const hasInteractions = /Interactions:\s*\d+/i.test(trimmedOutput);
        const hasFacts = /Knowledge Facts:\s*\d+/i.test(trimmedOutput);
        const hasSummaries = /Summaries:\s*\d+/i.test(trimmedOutput);
        const hasVectors = /Vector Embeddings:\s*\d+/i.test(trimmedOutput);

        if (hasHeader && hasInteractions && hasFacts && hasSummaries && hasVectors) {
            return {
                status: "pass",
                reason: `Local verification passed: Memory system statistics validated across all 4 layers.`
            };
        }
    }

    // 9. Fallback for tools without deterministic rules yet (keeps LLM verification for uncertain cases)
    return {
        status: "uncertain",
        reason: `No local deterministic verifier rule for tool '${toolName}'. Falling back to Gemini verifier.`
    };
}
