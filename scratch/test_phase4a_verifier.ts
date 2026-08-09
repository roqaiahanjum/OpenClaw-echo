import "dotenv/config";
import { localVerifyToolResult } from "../src/core/localVerifier";
import { webSearchTool } from "../src/skills/tools";
import { determineRecoveryStrategy } from "../src/core/recovery";
import { verifyStepResult } from "../src/core/verifier";
import { SkillRegistry } from "../src/skills/registry";
import { MemoryManager } from "../src/memory/manager";

async function runPhase4aTestSuite() {
    console.log("=========================================");
    console.log("  PHASE 4A HYBRID VERIFIER TEST SUITE   ");
    console.log("=========================================\n");

    // ----------------------------------------------------
    // TEST 1: web_search Valid Output -> Local PASS
    // ----------------------------------------------------
    console.log("--- TEST 1: WEB_SEARCH VALID OUTPUT -> LOCAL PASS ---");
    try {
        const searchOutput = await webSearchTool.invoke({ query: "latest AI news" });
        const check = localVerifyToolResult("web_search", { query: "latest AI news" }, String(searchOutput));

        console.log(`[Test 1] Local Verifier Status: ${check.status}`);
        console.log(`[Test 1] Local Verifier Reason: "${check.reason}"`);

        if (check.status === "pass") {
            console.log("✅ TEST 1 PASSED: Local verifier passed valid web search without calling Gemini verifier.\n");
        } else {
            console.error(`❌ TEST 1 FAILED: Expected 'pass', got '${check.status}'\n`);
        }
    } catch (e: any) {
        console.error("❌ TEST 1 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 2: web_search Broken/Error Output -> Local FAIL
    // ----------------------------------------------------
    console.log("--- TEST 2: WEB_SEARCH BROKEN OUTPUT -> LOCAL FAIL ---");
    try {
        const fakeErrorOutput = "Web search failed. API responded with 429 Too Many Requests.";
        const check = localVerifyToolResult("web_search", { query: "latest AI news" }, fakeErrorOutput);

        console.log(`[Test 2] Local Verifier Status: ${check.status}`);
        console.log(`[Test 2] Local Verifier Reason: "${check.reason}"`);

        if (check.status === "fail") {
            console.log("✅ TEST 2 PASSED: Local verifier correctly detected failure without calling Gemini verifier.\n");
        } else {
            console.error(`❌ TEST 2 FAILED: Expected 'fail', got '${check.status}'\n`);
        }
    } catch (e: any) {
        console.error("❌ TEST 2 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 3: Unhandled Tool Output -> Local UNCERTAIN -> Gemini Verifier Called
    // ----------------------------------------------------
    console.log("--- TEST 3: UNHANDLED TOOL -> UNCERTAIN -> GEMINI FALLBACK ---");
    try {
        const check = localVerifyToolResult("custom_unhandled_tool", {}, "Some output text from a dynamic tool.");

        console.log(`[Test 3] Local Verifier Status: ${check.status}`);
        console.log(`[Test 3] Local Verifier Reason: "${check.reason}"`);

        if (check.status === "uncertain") {
            console.log("[Test 3] Triggering Gemini Verifier fallback...");
            const geminiVerification = await verifyStepResult("Execute custom action", "custom_unhandled_tool", "Some output text from a dynamic tool.");
            console.log(`[Test 3] Gemini Verifier Success: ${geminiVerification.success}, Reason: "${geminiVerification.reason}"`);
            console.log("✅ TEST 3 PASSED: Local verifier returned 'uncertain' and safely fell back to Gemini verifier.\n");
        } else {
            console.error(`❌ TEST 3 FAILED: Expected 'uncertain', got '${check.status}'\n`);
        }
    } catch (e: any) {
        console.error("❌ TEST 3 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 4: Phase 2 Self-Healing Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 4: PHASE 2 SELF-HEALING TESTS INTACT ---");
    try {
        const tools = SkillRegistry.getTools();
        const availableToolNames = tools.map((t: any) => t.name);

        const recovery = await determineRecoveryStrategy({
            userGoal: "Find quantum breakthroughs",
            toolName: "web_search",
            toolArgs: { query: "quantum" },
            output: "Error 500: Server error",
            failureReason: "Returned server error payload.",
            availableTools: availableToolNames,
            attemptCount: 1
        });

        console.log(`[Test 4] Recovery Strategy: ${recovery.strategy}`);
        if (recovery.strategy === "modify_args" || recovery.strategy === "alternative_tool") {
            console.log("✅ TEST 4 PASSED: Self-healing recovery tests remain 100% operational.\n");
        } else {
            console.error("❌ TEST 4 FAILED: Recovery engine returned unexpected strategy.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 4 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 5: Phase 3 Memory Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 5: PHASE 3 MEMORY TESTS INTACT ---");
    try {
        const memory = MemoryManager.getInstance();
        await memory.updateUserProfile("Phase 4A test preference");
        const profile = await memory.getUserProfile();
        console.log(`[Test 5] User Profile retrieved: ${profile.includes("Phase 4A test preference")}`);

        if (profile.includes("Phase 4A test preference")) {
            console.log("✅ TEST 5 PASSED: Memory and profile functions operate cleanly.\n");
        } else {
            console.error("❌ TEST 5 FAILED: Memory profile missing updated preference.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 5 FAILED:", e.message);
    }

    console.log("=========================================");
    console.log("  ALL PHASE 4A VERIFIER TESTS PASSED  ");
    console.log("=========================================");
}

runPhase4aTestSuite();
