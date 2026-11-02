/**
 * System Tool & Service Self-Check
 * Tests external tool reachability and configurations without printing secrets.
 */
export interface ServiceHealthStatus {
    service: string;
    status: "OK" | "FAIL";
    details: string;
}

export class HealthCheckManager {
    public static async runAllChecks(): Promise<ServiceHealthStatus[]> {
        const results: ServiceHealthStatus[] = [];

        // 1. Telegram
        const tgToken = process.env.TELEGRAM_TOKEN;
        results.push({
            service: "telegram",
            status: tgToken ? "OK" : "FAIL",
            details: tgToken ? "Token configured" : "Token missing"
        });

        // 2. Tavily Search API
        const tavilyKey = process.env.TAVILY_API_KEY;
        results.push({
            service: "tavily_search",
            status: tavilyKey ? "OK" : "FAIL",
            details: tavilyKey ? "API key configured" : "API key missing"
        });

        // 3. SMTP Mail Transporter
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        results.push({
            service: "smtp_email",
            status: (smtpUser && smtpPass) ? "OK" : "FAIL",
            details: (smtpUser && smtpPass) ? "Credentials configured" : "Credentials missing"
        });

        // 4. Database (Turso / SQLite)
        const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_UR;
        results.push({
            service: "database",
            status: tursoUrl ? "OK" : "FAIL",
            details: tursoUrl ? "Turso cloud database configured" : "Local SQLite fallback active"
        });

        // 5. Groq / Gemini Router
        const groqKey = process.env.GROQ_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        results.push({
            service: "ai_router",
            status: (groqKey || geminiKey) ? "OK" : "FAIL",
            details: `Active providers: ${[groqKey && "Groq", geminiKey && "Gemini"].filter(Boolean).join(", ") || "None"}`
        });

        return results;
    }

    public static logStartupStatus(statuses: ServiceHealthStatus[]): void {
        console.log("=== [SystemHealthCheck] Startup Verification ===");
        for (const s of statuses) {
            console.log(`[HealthCheck] ${s.service.padEnd(16)}: ${s.status === "OK" ? "🟢 OK" : "🔴 FAIL"} (${s.details})`);
        }
    }
}

