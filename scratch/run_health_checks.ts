import {
    currentTimeTool,
    runSystemAuditTool,
    localFileSystemTool,
    writeSandboxFileTool,
    runSandboxCodeTool,
    getMemoryStatsTool,
    searchMemoryTool,
    webSearchTool
} from "../src/skills/tools";
import { MemoryManager } from "../src/memory/manager";
import * as dotenv from "dotenv";

dotenv.config();

interface TestResult {
    toolName: string;
    status: "PASS" | "FAIL";
    details: string;
}

async function runHealthChecks() {
    console.log("=== STARTING FULL SYSTEM & TOOL HEALTH CHECK ===\n");
    const results: TestResult[] = [];

    // Ensure memory is initialized
    try {
        await MemoryManager.getInstance().initialize();
    } catch (e: any) {
        console.warn("Memory initialization warning:", e.message);
    }

    // 1. Time & Environment
    console.log("Testing: get_current_time...");
    try {
        const res = await currentTimeTool.invoke({});
        results.push({ toolName: "get_current_time", status: "PASS", details: String(res).replace(/\n/g, " ") });
    } catch (e: any) {
        results.push({ toolName: "get_current_time", status: "FAIL", details: e.message });
    }

    console.log("Testing: run_system_audit...");
    try {
        const res = await runSystemAuditTool.invoke({});
        results.push({ toolName: "run_system_audit", status: "PASS", details: String(res).replace(/\n/g, " ") });
    } catch (e: any) {
        results.push({ toolName: "run_system_audit", status: "FAIL", details: e.message });
    }

    // 2. File System & Sandbox
    console.log("Testing: local_file_system...");
    try {
        const res = await localFileSystemTool.invoke({ action: "list" });
        results.push({ toolName: "local_file_system (list)", status: "PASS", details: `Workspace files found (truncated): ${String(res).slice(0, 100).replace(/\n/g, ", ")}...` });
    } catch (e: any) {
        results.push({ toolName: "local_file_system (list)", status: "FAIL", details: e.message });
    }

    console.log("Testing: write_sandbox_file (text)...");
    try {
        const res = await writeSandboxFileTool.invoke({ fileName: "health_check.txt", content: "Diagnostic text output from health check." });
        results.push({ toolName: "write_sandbox_file (health_check.txt)", status: "PASS", details: String(res) });
    } catch (e: any) {
        results.push({ toolName: "write_sandbox_file (health_check.txt)", status: "FAIL", details: e.message });
    }

    console.log("Testing: write_sandbox_file (js)...");
    try {
        await writeSandboxFileTool.invoke({ fileName: "health_check.js", content: "console.log('Health Check Sandbox Executed Successfully');" });
        const res = await runSandboxCodeTool.invoke({ fileName: "health_check.js" });
        results.push({ toolName: "run_sandbox_code (health_check.js)", status: "PASS", details: String(res).replace(/\n/g, " ") });
    } catch (e: any) {
        results.push({ toolName: "run_sandbox_code (health_check.js)", status: "FAIL", details: e.message });
    }

    // 3. Memory & Knowledge
    console.log("Testing: get_memory_stats...");
    try {
        const res = await getMemoryStatsTool.invoke({});
        results.push({ toolName: "get_memory_stats", status: "PASS", details: String(res).replace(/\n/g, " ") });
    } catch (e: any) {
        results.push({ toolName: "get_memory_stats", status: "FAIL", details: e.message });
    }

    console.log("Testing: search_memory...");
    try {
        const res = await searchMemoryTool.invoke({ query: "deployment" });
        results.push({ toolName: "search_memory", status: "PASS", details: String(res).slice(0, 100).replace(/\n/g, " ") + "..." });
    } catch (e: any) {
        results.push({ toolName: "search_memory", status: "FAIL", details: e.message });
    }

    // 4. Web & Search API
    console.log("Testing: web_search...");
    try {
        const res = await webSearchTool.invoke({ query: "OpenClaw Echo status" });
        results.push({ toolName: "web_search", status: "PASS", details: String(res).slice(0, 100).replace(/\n/g, " ") + "..." });
    } catch (e: any) {
        results.push({ toolName: "web_search", status: "FAIL", details: e.message });
    }

    console.log("\n=== HEALTH CHECK DIAGNOSTIC RESULTS ===\n");
    console.log(JSON.stringify(results, null, 2));
}

runHealthChecks().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
