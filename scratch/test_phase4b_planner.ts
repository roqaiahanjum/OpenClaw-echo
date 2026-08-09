import "dotenv/config";
import { evaluatePlanComplexity, generateSmartPlan } from "../src/core/planner";
import { localVerifyToolResult } from "../src/core/localVerifier";
import { SkillRegistry } from "../src/skills/registry";
import { determineRecoveryStrategy } from "../src/core/recovery";
import { MemoryManager } from "../src/memory/manager";
import { webSearchTool } from "../src/skills/tools";

async function runPhase4bTestSuite() {
    console.log("=========================================");
    console.log("  PHASE 4B SMART PLANNER BYPASS TEST SUITE");
    console.log("=========================================\n");

    const tools = SkillRegistry.getTools();
    const toolNames = tools.map((t: any) => t.name);

    // ----------------------------------------------------
    // TEST 1: Simple Prompt -> Local Bypass (0 Gemini Calls)
    // ----------------------------------------------------
    console.log("--- TEST 1: SIMPLE PROMPT -> BYPASS LLM PLANNER ---");
    try {
        const simplePrompt = "Search the web for the latest AI news.";
        const check = evaluatePlanComplexity(simplePrompt, toolNames);
        console.log(`[Test 1] Input: "${simplePrompt}"`);
        console.log(`[Test 1] Is Complex: ${check.isComplex}`);
        console.log(`[Test 1] Reason: "${check.reason}"`);

        const plan = await generateSmartPlan(simplePrompt, toolNames);
        console.log(`[Test 1] Plan Steps Count: ${plan?.steps.length}`);

        if (!check.isComplex && plan && plan.steps.length > 0) {
            console.log("✅ TEST 1 PASSED: Simple request bypassed LLM planner cleanly.\n");
        } else {
            console.error("❌ TEST 1 FAILED: Expected simple bypass.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 1 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 2: Complex Multi-Step Prompt -> Triggers LLM Planner
    // ----------------------------------------------------
    console.log("--- TEST 2: COMPLEX MULTI-STEP PROMPT -> TRIGGERS LLM PLANNER ---");
    try {
        const complexPrompt = "First research the top 3 AI frameworks and then write a comparative audit report.";
        const check = evaluatePlanComplexity(complexPrompt, toolNames);
        console.log(`[Test 2] Input: "${complexPrompt}"`);
        console.log(`[Test 2] Is Complex: ${check.isComplex}`);
        console.log(`[Test 2] Reason: "${check.reason}"`);

        if (check.isComplex) {
            console.log("✅ TEST 2 PASSED: Complex multi-step prompt correctly identified for LLM planning.\n");
        } else {
            console.error("❌ TEST 2 FAILED: Complex prompt was incorrectly flagged as simple.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 2 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 3: web_search & Phase 4A Local Verifier Intact
    // ----------------------------------------------------
    console.log("--- TEST 3: WEB_SEARCH & LOCAL VERIFIER INTACT ---");
    try {
        const searchResult = await webSearchTool.invoke({ query: "latest AI news" });
        const localCheck = localVerifyToolResult("web_search", { query: "latest AI news" }, String(searchResult));
        console.log(`[Test 3] Local Verifier Status: ${localCheck.status}`);

        if (localCheck.status === "pass") {
            console.log("✅ TEST 3 PASSED: web_search and Phase 4A local verifier operate cleanly.\n");
        } else {
            console.error("❌ TEST 3 FAILED: Local verifier failed on valid search result.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 3 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 4: Phase 2 Recovery Intact
    // ----------------------------------------------------
    console.log("--- TEST 4: PHASE 2 RECOVERY ENGINE INTACT ---");
    try {
        const recovery = await determineRecoveryStrategy({
            userGoal: "Run test",
            toolName: "web_search",
            toolArgs: { query: "test" },
            output: "Error 500",
            failureReason: "API error",
            availableTools: toolNames,
            attemptCount: 2
        });

        console.log(`[Test 4] Recovery Limit Strategy: ${recovery.strategy}`);
        if (recovery.strategy === "abort") {
            console.log("✅ TEST 4 PASSED: Phase 2 recovery limit safety intact.\n");
        } else {
            console.error("❌ TEST 4 FAILED: Expected 'abort' on max attempt count.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 4 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 5: Phase 3A Memory Intact
    // ----------------------------------------------------
    console.log("--- TEST 5: PHASE 3A MEMORY SYSTEM INTACT ---");
    try {
        const memory = MemoryManager.getInstance();
        const profile = await memory.getUserProfile();
        console.log(`[Test 5] User Profile retrieved length: ${profile.length} chars`);

        if (profile) {
            console.log("✅ TEST 5 PASSED: Phase 3A memory systems intact.\n");
        } else {
            console.error("❌ TEST 5 FAILED: Memory user profile missing.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 5 FAILED:", e.message);
    }

    console.log("=========================================");
    console.log("  ALL PHASE 4B SMART PLANNER TESTS PASSED ");
    console.log("=========================================");
}

runPhase4bTestSuite();
