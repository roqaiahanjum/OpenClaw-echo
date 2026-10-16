import { localVerifyToolResult } from "../src/core/localVerifier";

function testDeterministicVerifier() {
    console.log("=== REGRESSION TEST: Deterministic Tool Verifier Rules ===");

    // 1. Test manage_project_goals
    console.log("\n[Test 1] Testing manage_project_goals verification...");
    const sampleGoalsOutput = `Goal operation 'list' processed. Current goals count: 2.\nGoals summary:\n[\n  {\n    "id": "goal_1",\n    "title": "Build Agent",\n    "status": "completed"\n  }\n]`;
    const resGoalsPass = localVerifyToolResult("manage_project_goals", { action: "list" }, sampleGoalsOutput);
    console.log(`Goals Pass Case: status=${resGoalsPass.status}, reason="${resGoalsPass.reason}"`);
    if (resGoalsPass.status !== "pass") throw new Error("FAIL: Goals output was not deterministically verified as pass!");

    const sampleGoalsFail = `Goal operation failed: Cannot read properties of undefined (reading 'length')`;
    const resGoalsFail = localVerifyToolResult("manage_project_goals", { action: "list" }, sampleGoalsFail);
    console.log(`Goals Fail Case: status=${resGoalsFail.status}, reason="${resGoalsFail.reason}"`);
    if (resGoalsFail.status !== "fail") throw new Error("FAIL: Goals failure was not caught deterministically!");

    // 2. Test manage_git_repository
    console.log("\n[Test 2] Testing manage_git_repository verification...");
    const sampleGitPass = `Git command [git status --short] output:\nM src/core/router.ts\n?? scratch/test.ts`;
    const resGitPass = localVerifyToolResult("manage_git_repository", { action: "status" }, sampleGitPass);
    console.log(`Git Pass Case: status=${resGitPass.status}, reason="${resGitPass.reason}"`);
    if (resGitPass.status !== "pass") throw new Error("FAIL: Git status output was not deterministically verified as pass!");

    const sampleGitFail = `Git operation failed: fatal: not a git repository (or any of the parent directories): .git`;
    const resGitFail = localVerifyToolResult("manage_git_repository", { action: "status" }, sampleGitFail);
    console.log(`Git Fail Case: status=${resGitFail.status}, reason="${resGitFail.reason}"`);
    if (resGitFail.status !== "fail") throw new Error("FAIL: Git failure was not caught deterministically!");

    // 3. Test get_memory_stats
    console.log("\n[Test 3] Testing get_memory_stats verification...");
    const sampleStatsPass = `Memory System Statistics:\nInteractions: 142\nKnowledge Facts: 48\nSummaries: 12\nVector Embeddings: 320`;
    const resStatsPass = localVerifyToolResult("get_memory_stats", {}, sampleStatsPass);
    console.log(`Stats Pass Case: status=${resStatsPass.status}, reason="${resStatsPass.reason}"`);
    if (resStatsPass.status !== "pass") throw new Error("FAIL: Memory stats output was not deterministically verified as pass!");

    const sampleStatsFail = `Error fetching memory stats: SQLITE_ERROR: no such table: memory_entries`;
    const resStatsFail = localVerifyToolResult("get_memory_stats", {}, sampleStatsFail);
    console.log(`Stats Fail Case: status=${resStatsFail.status}, reason="${resStatsFail.reason}"`);
    if (resStatsFail.status !== "fail") throw new Error("FAIL: Memory stats failure was not caught deterministically!");

    // 4. Test Fallback for genuine uncertain cases
    console.log("\n[Test 4] Testing Fallback to LLM for unknown tools...");
    const resUnknown = localVerifyToolResult("unknown_experimental_tool", {}, "Arbitrary text output");
    console.log(`Unknown Tool Case: status=${resUnknown.status}, reason="${resUnknown.reason}"`);
    if (resUnknown.status !== "uncertain") throw new Error("FAIL: Unknown tool should fall back to uncertain!");

    console.log("\n✅ ALL DETERMINISTIC VERIFIER TESTS PASSED.");
}

testDeterministicVerifier();
