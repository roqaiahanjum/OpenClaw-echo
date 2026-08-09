// @ts-nocheck
import { SubAgentManager } from "../src/agents/SubAgentManager";
import { ACPTask } from "../src/agents/types";
import { decomposeIntoACPTasks } from "../src/core/planner";

async function runOmniSubAgentTest() {
    console.log("==================================================");
    console.log(" 🚀 OMNI V4 PARITY: SUB-AGENT DELEGATION TEST 🚀 ");
    console.log("==================================================\n");

    const tStart = Date.now();
    const prompt = "Research Turing machines historical significance and write a TypeScript code script for a palindrome checker";

    console.log(`Prompt: "${prompt}"\n`);
    console.log("1. Decomposing prompt into ACP Tasks...");

    const tasks: ACPTask[] = decomposeIntoACPTasks(prompt, "parent_test_101");
    console.log(`Decomposed into ${tasks.length} ACP Tasks:`);
    tasks.forEach(t => console.log(`  • Task [${t.taskId}] -> Target: ${t.targetAgent} (Parent: ${t.parentId})`));

    console.log("\n2. Dispatching ACP Tasks in parallel via SubAgentManager...");
    const results = await SubAgentManager.getInstance().delegateTasksParallel(tasks);

    const totalDuration = Date.now() - tStart;
    console.log(`\n3. Execution finished in ${totalDuration}ms.`);

    console.log("\n=== ACP RESULTS ===");
    results.forEach((r, idx) => {
        console.log(`\n--- Result ${idx + 1} (${r.targetAgent.toUpperCase()}) ---`);
        console.log(`Task ID: ${r.taskId}`);
        console.log(`Status: ${r.status}`);
        console.log(`Execution Time: ${r.executionTimeMs}ms`);
        console.log(`Output Snippet:\n${r.resultData.substring(0, 250)}...`);
    });

    const allSuccess = results.every(r => r.status === "SUCCESS");
    const hasResearch = results.some(r => r.targetAgent === "research" && r.status === "SUCCESS");
    const hasCode = results.some(r => r.targetAgent === "coding" && r.status === "SUCCESS");
    const isUnder35s = totalDuration < 35000;

    console.log("\n=== VERIFICATION SUMMARY ===");
    console.log(`• All Workers Status == 'SUCCESS': ${allSuccess ? "YES ✅" : "NO ❌"}`);
    console.log(`• Research Worker Success: ${hasResearch ? "YES ✅" : "NO ❌"}`);
    console.log(`• Coding Worker Success: ${hasCode ? "YES ✅" : "NO ❌"}`);
    console.log(`• Total Execution Time < 35s: ${isUnder35s ? `YES (${totalDuration}ms) ✅` : `NO (${totalDuration}ms) ❌`}`);

    if (allSuccess && hasResearch && hasCode && isUnder35s) {
        console.log("\n✅ SUCCESS: Omni Sub-Agent Delegation & ACP Protocol fully functional and verified!");
        process.exit(0);
    } else {
        console.error("\n❌ FAILURE: Verification conditions not met.");
        process.exit(1);
    }
}

runOmniSubAgentTest().catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
});
