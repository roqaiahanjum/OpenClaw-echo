import * as dotenv from "dotenv";
dotenv.config();

import { exec } from "child_process";
import { promisify } from "util";
import { StartupValidator } from "../src/core/startupValidator";

const execAsync = promisify(exec);

async function runPreflight(): Promise<void> {
    console.log("=============================================================");
    console.log("       🚀 OPENCLAW ECHO: PRODUCTION PREFLIGHT GATE 🚀        ");
    console.log("=============================================================\n");

    let allPassed = true;

    // Gate 1: Git Release Verification
    console.log("--- 1. Git Release & Commit Verification ---");
    try {
        const { stdout: commit } = await execAsync("git rev-parse HEAD");
        const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD");
        const { stdout: status } = await execAsync("git status --porcelain");

        console.log(`• HEAD Commit: ${commit.trim()}`);
        console.log(`• Branch:      ${branch.trim()}`);
        
        const dirtyFiles = status.trim().split("\n").filter(Boolean);
        if (dirtyFiles.length > 0) {
            console.log(`⚠️  Working tree has ${dirtyFiles.length} uncommitted file(s).`);
        } else {
            console.log(`✅ Working tree is clean.`);
        }
    } catch (err: any) {
        console.log(`❌ Git verification error: ${err.message}`);
        allPassed = false;
    }

    // Gate 2: Read-Only System Health & Configuration Check
    console.log("\n--- 2. Integration Health & Configuration Check ---");
    try {
        const report = await StartupValidator.checkSystemHealth();
        console.log(`• Database:    ${report.integrations.database.status} (${report.integrations.database.details})`);
        console.log(`• AI Router:   ${report.integrations.aiRouter.status} (${report.integrations.aiRouter.details})`);
        console.log(`• Web Search:  ${report.integrations.webSearch.status} (${report.integrations.webSearch.details})`);
        console.log(`• Telegram:    ${report.integrations.telegramBot.status} (${report.integrations.telegramBot.details})`);
        console.log(`• SMTP Email:  ${report.integrations.smtpEmail.status} (${report.integrations.smtpEmail.details})`);
        console.log(`• Sandbox Dir: ${report.integrations.sandbox.status} (${report.integrations.sandbox.details})`);

        if (!report.allCriticalHealthy) {
            console.log("❌ One or more critical integrations failed health checks.");
            allPassed = false;
        } else {
            console.log("✅ Critical runtime configurations verified.");
        }
    } catch (err: any) {
        console.log(`❌ Health check failure: ${err.message}`);
        allPassed = false;
    }

    // Gate 3: TypeScript Compilation Check
    console.log("\n--- 3. Strict Type Check (`tsc --noEmit`) ---");
    try {
        await execAsync("npx tsc --noEmit");
        console.log("✅ TypeScript compiler passed with zero errors.");
    } catch (err: any) {
        console.log(`❌ TypeScript compiler failed:\n${err.stdout || err.message}`);
        allPassed = false;
    }

    // Gate 4: Tool Execution Contract & Honesty Verification
    console.log("\n--- 4. Tool Execution Contract & Honesty Verification ---");
    try {
        const { stdout: testOut } = await execAsync("npx ts-node --transpile-only scratch/test_all_25_tools_complete.ts", { timeout: 35000 });
        if (testOut.includes("53 PASSED, 0 FAILED")) {
            console.log("✅ All 25 tools verified with zero failures (53/53 passed).");
        } else {
            console.log("❌ Tool test suite returned unexpected output.");
            allPassed = false;
        }
    } catch (err: any) {
        console.log(`❌ Tool test suite execution error: ${err.message}`);
        allPassed = false;
    }

    console.log("\n=============================================================");
    if (allPassed) {
        console.log("🎉 PREFLIGHT VERIFICATION PASSED: Release candidate is verified.");
        console.log("=============================================================");
        process.exit(0);
    } else {
        console.log("💥 PREFLIGHT VERIFICATION FAILED: Do NOT deploy this release.");
        console.log("=============================================================");
        process.exit(1);
    }
}

runPreflight().catch(err => {
    console.error("Fatal preflight error:", err);
    process.exit(1);
});

