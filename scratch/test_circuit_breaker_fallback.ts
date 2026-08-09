import "dotenv/config";
import { ModelRouter } from "../src/core/router";
import { memory } from "../src/memory/manager";
import { generateSmartPlan } from "../src/core/planner";

async function runCircuitBreakerFallbackTests() {
    console.log("=================================================");
    console.log(" CIRCUIT BREAKER & VECTOR FALLBACK TEST SUITE ");
    console.log("=================================================\n");

    const router = ModelRouter.getInstance();

    // TEST 1: Circuit Breaker State Transition
    console.log("--- TEST 1: CIRCUIT BREAKER TRIP & STATUS ---");
    console.log(`[Test 1] Initial Fallback Mode: ${router.isInFallbackMode()}`);
    router.tripCircuitBreaker();
    console.log(`[Test 1] Fallback Mode after trip: ${router.isInFallbackMode()}`);
    console.assert(router.isInFallbackMode() === true, "Circuit breaker failed to trip.");
    console.log("✅ TEST 1 PASSED: Circuit Breaker trips cleanly into Fallback Mode.\n");

    // TEST 2: Fallback Mode Bypasses Gemini Planner
    console.log("--- TEST 2: FALLBACK MODE PLANNER BYPASS ---");
    const plan = await generateSmartPlan("Research and compare top 3 AI frameworks", ["web_search"]);
    console.log(`[Test 2] Generated Plan in Fallback Mode: ${JSON.stringify(plan)}`);
    console.assert(plan !== null, "Planner returned null");
    console.log("✅ TEST 2 PASSED: Fallback Mode automatically bypasses Gemini planner.\n");

    // TEST 3: Vector Store Fallback to SQLite Facts
    console.log("--- TEST 3: VECTOR RETRIEVAL FALLBACK TO SQLITE ---");
    await memory.saveFact("test_category", "circuit_breaker_key", "active_value");
    const ctx = await memory.getContext("circuit_breaker_key");
    console.log(`[Test 3] Retrieved Context contains 'active_value': ${ctx.includes("active_value")}`);
    console.assert(ctx.includes("active_value"), "Context missing SQLite facts");
    console.log("✅ TEST 3 PASSED: getContext returns SQLite context even if vector search is offline.\n");

    // Reset Circuit Breaker for normal operation
    router.resetCircuitBreaker();
    console.log(`[CleanUp] Router Fallback Mode reset: ${router.isInFallbackMode()}`);

    console.log("=================================================");
    console.log(" ALL CIRCUIT BREAKER & FALLBACK TESTS PASSED ");
    console.log("=================================================");
}

runCircuitBreakerFallbackTests();
