import { Telemetry } from "./telemetry";

/**
 * Sanitizes strings by redacting API keys, Telegram tokens, passwords, and private data.
 */
export function sanitizeLogText(raw: string): string {
    if (!raw || typeof raw !== "string") return "";

    let sanitized = raw;

    // 1. Redact known environment secrets if present
    const envSecrets = [
        process.env.TELEGRAM_TOKEN,
        process.env.GOOGLE_API_KEY,
        process.env.GEMINI_API_KEY,
        process.env.GROQ_API_KEY,
        process.env.TAVILY_API_KEY,
        process.env.SMTP_PASS,
        process.env.SMTP_USER,
    ];

    for (const secret of envSecrets) {
        if (secret && secret.length >= 6) {
            sanitized = sanitized.split(secret).join("[REDACTED_SECRET]");
        }
    }

    // 2. Redact Telegram Bot Token pattern: e.g. 123456789:ABCdef-GHIjkl...
    sanitized = sanitized.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,45}\b/g, "[REDACTED_TELEGRAM_TOKEN]");

    // 3. Redact Google API Key pattern: e.g. AIzaSy...
    sanitized = sanitized.replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, "[REDACTED_GOOGLE_KEY]");

    // 4. Redact Groq API Key pattern: e.g. gsk_...
    sanitized = sanitized.replace(/\bgsk_[a-zA-Z0-9]{30,60}\b/g, "[REDACTED_GROQ_KEY]");

    // 5. Redact Tavily API Key pattern: e.g. tvly-...
    sanitized = sanitized.replace(/\btvly-[a-zA-Z0-9]{25,50}\b/g, "[REDACTED_TAVILY_KEY]");

    // 6. Redact Bearer authorization headers
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, "Bearer [REDACTED_TOKEN]");

    // 7. Redact inline password / credential assignments
    sanitized = sanitized.replace(/(password|passwd|secret|token|api_?key)\s*[:=]\s*["']?[^\s"',;]+["']?/gi, "$1=[REDACTED]");

    return sanitized;
}

/**
 * Simple in-memory logger for the Diagnostic Dashboard.
 * Keeps the last 50 logs for live viewing.
 */
export class DashboardLogger {
    private static logs: { time: string, message: string }[] = [];
    private static MAX_LOGS = 50;

    static log(message: string) {
        const cleanMessage = sanitizeLogText(message);
        const time = new Date().toLocaleTimeString();
        const logEntry = { time, message: cleanMessage };
        this.logs.unshift(logEntry);
        
        if (this.logs.length > this.MAX_LOGS) {
            this.logs.pop();
        }
        
        // Also print to console
        console.log(`[${time}] ${cleanMessage}`);

        // Broadcast to Dashboard immediately via SSE
        Telemetry.broadcast("log", logEntry);
    }

    static structured(event: string, meta: Record<string, any>) {
        const parts = Object.entries(meta).map(([k, v]) => {
            const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
            return `[${k}:${sanitizeLogText(valStr)}]`;
        });
        const logLine = `[StructuredLog] [Event:${event}] ${parts.join(" ")}`;
        console.log(logLine);
    }

    static getLogs() {
        return this.logs;
    }
}

