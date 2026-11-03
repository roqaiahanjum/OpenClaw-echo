import { sanitizeLogText } from "./logger";

export type ErrorCategory = 
    | "AUTH_CONFIG" 
    | "NETWORK_TIMEOUT" 
    | "UPSTREAM_5XX" 
    | "VALIDATION" 
    | "TOOL_UNAVAILABLE"
    | "NONE";

export type ExecutionContractStatus = "SUCCESS" | "FAILED" | "BLOCKED" | "DEGRADED";

export interface StructuredExecutionRecord {
    requestId: string;
    selectedAgent: string;
    selectedTool: string;
    executionStatus: ExecutionContractStatus;
    durationMs: number;
    errorCategory: ErrorCategory;
    details?: string;
}

export class ToolExecutionContract {
    /**
     * Emits a standardized, sanitized structured execution log entry.
     * Guaranteed never to log API keys, tokens, or PII.
     */
    public static logExecution(record: StructuredExecutionRecord): void {
        const cleanDetails = record.details ? sanitizeLogText(record.details).replace(/\n/g, " ").slice(0, 200) : "";
        const detailsSegment = cleanDetails ? ` [Details:${cleanDetails}]` : "";
        
        console.log(
            `[StructuredExecution] [ReqId:${record.requestId}] ` +
            `[Agent:${record.selectedAgent}] ` +
            `[Tool:${record.selectedTool}] ` +
            `[Status:${record.executionStatus}] ` +
            `[DurationMs:${record.durationMs}] ` +
            `[ErrorCategory:${record.errorCategory}]` +
            detailsSegment
        );
    }

    /**
     * Classifies a tool output error string into a standard ErrorCategory.
     */
    public static categorizeError(errorText?: string): ErrorCategory {
        if (!errorText) return "NONE";
        const lower = errorText.toLowerCase();

        if (
            lower.includes("not configured") || 
            lower.includes("api key") || 
            lower.includes("credentials") || 
            lower.includes("unauthorized") ||
            lower.includes("eauth") ||
            lower.includes("forbidden") ||
            lower.includes("username and password") ||
            lower.includes("badcredentials") ||
            lower.includes("535") ||
            lower.includes("auth failed") ||
            lower.includes("authentication")
        ) {
            return "AUTH_CONFIG";
        }

        if (
            lower.includes("timeout") || 
            lower.includes("timed out") || 
            lower.includes("etimedout") || 
            lower.includes("enotfound") ||
            lower.includes("fetch failed") ||
            lower.includes("connection closed")
        ) {
            return "NETWORK_TIMEOUT";
        }

        if (
            lower.includes("status 5") || 
            lower.includes("502") || 
            lower.includes("503") || 
            lower.includes("500") || 
            lower.includes("bad gateway") ||
            lower.includes("service unavailable")
        ) {
            return "UPSTREAM_5XX";
        }

        if (
            lower.includes("validation") || 
            lower.includes("security") || 
            lower.includes("ssrf") || 
            lower.includes("traversal") ||
            lower.includes("malformed") ||
            lower.includes("rejected")
        ) {
            return "VALIDATION";
        }

        if (lower.includes("not registered") || lower.includes("disabled")) {
            return "TOOL_UNAVAILABLE";
        }

        return "VALIDATION";
    }

    /**
     * Verifies if a user prompt requires a tool.
     */
    public static inspectRequiredTool(prompt: string): { requiresTool: boolean; expectedTool?: string; targetAgent?: string } {
        const lower = prompt.toLowerCase();

        // 1. Web Search
        if (/\b(?:re?search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?|search(?:\s+(?:the\s+(?:web|internet)|online|google|bing))?(?:\s+for)?|look\s+up|web\s+search)\b/i.test(lower)) {
            // Guard: Not a memory search
            if (!/\b(?:search\s+memory|saved\s+facts?|my\s+notes?)\b/i.test(lower)) {
                return { requiresTool: true, expectedTool: "web_search", targetAgent: "research" };
            }
        }

        // 2. Code Execution & Sandbox
        if (
            /\b(?:run|execute|eval)\s+(?:the\s+)?(?:code|script|program)\b/i.test(lower) ||
            /\b(?:write|create|generate|implement)\s+(?:a\s+|some\s+)?(?:[a-zA-Z0-9_\-]+\s+)*(?:code|script|function|program|solution|file|sandbox\s+file)\b/i.test(lower) ||
            /\b(?:in\s+(?:the\s+)?(?:permitted\s+)?sandbox|sandbox\s+file)\b/i.test(lower) ||
            /\.(?:ts|js|py)\b/i.test(lower)
        ) {
            return { requiresTool: true, expectedTool: "write_sandbox_file", targetAgent: "coding" };
        }

        // 3. Web Scraping & URL Browsing
        if (/https?:\/\/[^\s"'<>)]+/i.test(lower) || /\b(?:browse|scrape|fetch|visit)\s+(?:the\s+)?(?:url|webpage|website)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "scrape_website", targetAgent: "browser" };
        }

        // 4. Email Report
        if (/\b(?:send\s+(?:an?\s+|the\s+)?email|email\s+to|mail\s+to|smtp)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "send_email_report", targetAgent: "conversation" };
        }

        // 5. Scheduled Tasks
        if (/\b(?:schedule\s+task|set\s+timer|cron)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "manage_scheduled_tasks", targetAgent: "conversation" };
        }

        // 6. Git Operations
        if (/\b(?:git\s+status|git\s+commit|git\s+diff|git\s+log)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "manage_git_repository", targetAgent: "conversation" };
        }

        // 7. Memory Operations
        if (/\b(?:remember\s+that|store\s+fact|search\s+memory|recall|saved\s+facts?)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "search_memory", targetAgent: "memory" };
        }

        // 8. System Diagnostics & Audit
        if (/\b(?:run\s+(?:system\s+)?audit|audit\s+system|check\s+system\s+health)\b/i.test(lower)) {
            return { requiresTool: true, expectedTool: "run_system_audit", targetAgent: "conversation" };
        }

        return { requiresTool: false };
    }
}
