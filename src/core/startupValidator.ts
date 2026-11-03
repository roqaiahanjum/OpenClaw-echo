import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { SANDBOX_DIR, SQLITE_DB_PATH } from "./storage";

const execAsync = promisify(exec);

export interface IntegrationHealth {
    status: "HEALTHY" | "DEGRADED" | "UNCONFIGURED" | "FAILED";
    details: string;
}

export interface SystemHealthReport {
    timestamp: string;
    gitCommit: string;
    gitBranch: string;
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    integrations: {
        database: IntegrationHealth;
        aiRouter: IntegrationHealth;
        webSearch: IntegrationHealth;
        telegramBot: IntegrationHealth;
        smtpEmail: IntegrationHealth;
        sandbox: IntegrationHealth;
    };
    allCriticalHealthy: boolean;
}

export class StartupValidator {
    /**
     * Retrieves the current Git commit and branch safely,
     * falling back to environment variables (e.g. RENDER_GIT_COMMIT) if Git CLI fails.
     */
    public static async getGitMetadata(): Promise<{ commit: string; branch: string }> {
        let commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unknown";
        let branch = process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || "unknown";

        try {
            const { stdout: commitOut } = await execAsync("git rev-parse HEAD", { timeout: 3000 });
            commit = commitOut.trim().slice(0, 7);
        } catch (_) {}

        try {
            const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", { timeout: 3000 });
            branch = branchOut.trim();
        } catch (_) {}

        return { commit, branch };
    }

    /**
     * Performs a read-only health check across all registered subsystems and integrations.
     */
    public static async checkSystemHealth(): Promise<SystemHealthReport> {
        const git = await this.getGitMetadata();

        // 1. Database Check
        let dbHealth: IntegrationHealth = { status: "HEALTHY", details: "Online" };
        try {
            const { DatabaseConnectionFactory } = await import("../memory/dbAdapter");
            const conn = DatabaseConnectionFactory.getConnection();
            const health = await conn.checkHealth();
            if (health.status === "connected") {
                dbHealth = { status: "HEALTHY", details: `Connected (${conn.getDriverName()})` };
            } else {
                dbHealth = { status: "DEGRADED", details: health.details || "Degraded connection" };
            }
        } catch (e: any) {
            dbHealth = { status: "FAILED", details: e.message };
        }

        // 2. Upstream AI Router Check
        let aiHealth: IntegrationHealth = { status: "HEALTHY", details: "Online" };
        try {
            const { ModelRouter } = await import("./router");
            const router = ModelRouter.getInstance();
            const health = await router.checkHealth();
            const providers: string[] = [];
            if (health.gemini?.status === "connected") providers.push("Gemini");
            if (health.groq?.status === "connected") providers.push("Groq");

            if (providers.length > 0) {
                aiHealth = { status: "HEALTHY", details: `Active providers: ${providers.join(", ")}` };
            } else {
                aiHealth = { status: "FAILED", details: "No upstream AI providers connected" };
            }
        } catch (e: any) {
            aiHealth = { status: "FAILED", details: e.message };
        }

        // 3. Web Search Check (Tavily)
        let searchHealth: IntegrationHealth = { status: "UNCONFIGURED", details: "TAVILY_API_KEY missing" };
        if (process.env.TAVILY_API_KEY) {
            searchHealth = { status: "HEALTHY", details: "TAVILY_API_KEY configured (live search enabled)" };
        }

        // 4. Telegram Bot Token Check
        let tgHealth: IntegrationHealth = { status: "FAILED", details: "TELEGRAM_TOKEN missing" };
        if (process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN) {
            tgHealth = { status: "HEALTHY", details: "Token configured" };
        }

        // 5. SMTP Email Check
        let smtpHealth: IntegrationHealth = { status: "UNCONFIGURED", details: "SMTP credentials missing" };
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            smtpHealth = { status: "HEALTHY", details: `Configured for ${process.env.SMTP_HOST || "smtp.gmail.com"}` };
        }

        // 6. Sandbox Directory Check
        let sandboxHealth: IntegrationHealth = { status: "HEALTHY", details: "Writable" };
        try {
            await fs.mkdir(SANDBOX_DIR, { recursive: true });
            const testFile = path.resolve(SANDBOX_DIR, `.probe_${Date.now()}.tmp`);
            await fs.writeFile(testFile, "probe", "utf-8");
            await fs.unlink(testFile);
            sandboxHealth = { status: "HEALTHY", details: `Writable at ${SANDBOX_DIR}` };
        } catch (e: any) {
            sandboxHealth = { status: "FAILED", details: e.message };
        }

        const criticalPass = 
            dbHealth.status !== "FAILED" && 
            aiHealth.status !== "FAILED" && 
            tgHealth.status !== "FAILED" && 
            sandboxHealth.status !== "FAILED";

        return {
            timestamp: new Date().toISOString(),
            gitCommit: git.commit,
            gitBranch: git.branch,
            nodeVersion: process.version,
            platform: `${process.platform} ${process.arch}`,
            uptimeSeconds: Math.floor(process.uptime()),
            integrations: {
                database: dbHealth,
                aiRouter: aiHealth,
                webSearch: searchHealth,
                telegramBot: tgHealth,
                smtpEmail: smtpHealth,
                sandbox: sandboxHealth
            },
            allCriticalHealthy: criticalPass
        };
    }

    /**
     * Prints a redacted startup banner and diagnostics report.
     */
    public static async printStartupReport(): Promise<void> {
        const report = await this.checkSystemHealth();
        console.log("=================================================");
        console.log("       🛡️  OPENCLAW ECHO STARTUP REPORT 🛡️       ");
        console.log("=================================================");
        console.log(` Commit:        ${report.gitCommit} (${report.gitBranch})`);
        console.log(` Runtime:       Node ${report.nodeVersion} on ${report.platform}`);
        console.log(` Database:      ${report.integrations.database.status} — ${report.integrations.database.details}`);
        console.log(` AI Providers:  ${report.integrations.aiRouter.status} — ${report.integrations.aiRouter.details}`);
        console.log(` Web Search:    ${report.integrations.webSearch.status} — ${report.integrations.webSearch.details}`);
        console.log(` Telegram Bot:  ${report.integrations.telegramBot.status} — ${report.integrations.telegramBot.details}`);
        console.log(` SMTP Relay:    ${report.integrations.smtpEmail.status} — ${report.integrations.smtpEmail.details}`);
        console.log(` Sandbox:       ${report.integrations.sandbox.status} — ${report.integrations.sandbox.details}`);
        console.log(` Overall State: ${report.allCriticalHealthy ? "🟢 READY FOR TRAFFIC" : "🔴 DEGRADED / BLOCKED"}`);
        console.log("=================================================");
    }
}

