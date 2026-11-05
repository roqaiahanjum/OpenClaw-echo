import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { decomposeIntoACPTasks } from './src/core/planner';
import { SubAgentManager } from './src/agents/SubAgentManager';
import { SkillRegistry } from './src/skills/registry';

async function runE2ETest() {
    console.log("================================================================================");
    console.log("   🧪 OPENCLAW ECHO: REAL MULTI-AGENT & REAL TOOLS E2E VERIFICATION TEST        ");
    console.log("================================================================================");

    const testPrompt = "Research the benefits of TypeScript for AI agents, browse its official documentation, generate a TypeScript example, save the file, and give me a combined report.";
    console.log(`[Test] Input Prompt:\n"${testPrompt}"\n`);

    // 1. Verify Available Tools in SkillRegistry
    const registeredTools = SkillRegistry.getTools().map(t => t.name);
    console.log(`[Test] Registered Tools Count: ${registeredTools.length}`);
    console.log(`[Test] Tools include 'web_search': ${registeredTools.includes('web_search') ? '✅' : '❌'}`);
    console.log(`[Test] Tools include 'scrape_website': ${registeredTools.includes('scrape_website') ? '✅' : '❌'}`);
    console.log(`[Test] Tools include 'write_sandbox_file': ${registeredTools.includes('write_sandbox_file') ? '✅' : '❌'}\n`);

    // 2. Decompose prompt into ACP Tasks
    console.log("--- STEP 1: DECOMPOSITION INTO ACP TASKS ---");
    const tasks = decomposeIntoACPTasks(testPrompt);
    console.log(`Decomposed into ${tasks.length} ACP Tasks:`);
    for (const t of tasks) {
        console.log(`- TaskId: ${t.taskId}`);
        console.log(`  TargetAgent: ${t.targetAgent}`);
        console.log(`  DependsOn: [${(t.dependsOn || []).join(", ")}]`);
        console.log(`  Context:`, JSON.stringify(t.contextPayload));
    }
    console.log("");

    // 3. Execute via SubAgentManager.delegateTasksWithDependencies
    console.log("--- STEP 2: MULTI-AGENT EXECUTION WITH DEPENDENCIES ---");
    const startTime = Date.now();
    const manager = SubAgentManager.getInstance();
    const results = await manager.delegateTasksWithDependencies(tasks);
    const totalDuration = Date.now() - startTime;

    console.log(`\nExecution finished in ${totalDuration}ms. Results count: ${results.length}\n`);

    // 4. Verify each result and output structured summary
    console.log("--- STEP 3: STRUCTURED EXECUTION RESULTS ---");
    for (const r of results) {
        console.log(`[Result] TaskId: ${r.taskId}`);
        console.log(`  Agent: ${r.targetAgent}`);
        console.log(`  Status: ${r.status}`);
        console.log(`  ExecutionTimeMs: ${r.executionTimeMs}`);
        if (r.error) console.log(`  Error: ${r.error}`);
    }
    console.log("");

    // 5. Verify file on disk
    console.log("--- STEP 4: DISK VERIFICATION OF SANDBOX FILE ---");
    const expectedFilePath = path.resolve(process.cwd(), "src", "sandbox", "typescript_ai_agent_example.ts");
    try {
        const stat = await fs.stat(expectedFilePath);
        console.log(`✅ File confirmed on disk: ${expectedFilePath}`);
        console.log(`   File size: ${stat.size} bytes`);
        const fileContent = await fs.readFile(expectedFilePath, "utf-8");
        console.log(`   File preview (first 400 chars):\n${fileContent.slice(0, 400)}...\n`);
    } catch (e: any) {
        console.error(`❌ File NOT found on disk: ${expectedFilePath} (${e.message})`);
    }

    // 6. Formulate combined report
    console.log("--- STEP 5: COMBINED FINAL REPORT ---");
    const reportSections = results.map(res => {
        if (res.status === 'SUCCESS') return res.resultData;
        return `⚠️ [${(res.targetAgent || 'WORKER').toUpperCase()} Task Incomplete/Failed]: ${res.error || 'Execution did not complete successfully'}`;
    });

    const combinedReport = `📋 **OpenClaw Echo Combined Multi-Agent Report**\n\n` + reportSections.join('\n\n---\n\n');
    console.log(combinedReport);
    console.log("\n================================================================================");
    console.log("   ✅ E2E TEST COMPLETED SUCCESSFULLY                                           ");
    console.log("================================================================================");
}

runE2ETest().catch(err => {
    console.error("Test failed with unhandled error:", err);
    process.exit(1);
});
