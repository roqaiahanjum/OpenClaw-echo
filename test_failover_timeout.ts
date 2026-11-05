import { ModelRouter } from "./src/core/router";
import { HumanMessage } from "@langchain/core/messages";
import * as assert from "assert";

async function runTimeoutTest() {
    console.log("=== Testing Per-Provider Timeout vs Global Waterfall Timeout ===");
    const router = ModelRouter.getInstance();

    // Test 1: Tiny primary-provider timeout (150ms). Groq cannot complete in 150ms, so Groq times out,
    // and the waterfall catches it and falls over to Gemini Flash, recovering successfully.
    console.log("\n[Test 1] Invoking with primaryTimeoutMs = 150 (Per-provider timeout)...");
    const t0 = Date.now();
    try {
        const response = await router.invoke(
            [new HumanMessage("Say 'per-provider fallback works'")],
            undefined,
            { primaryTimeoutMs: 150 }
        );
        assert.ok(response && response.content, "Expected response from fallback provider");
        console.log(`[Test 1 PASS] Recovered via fallback in ${Date.now() - t0}ms! Response: "${(response.content || "").slice(0, 60)}"`);
    } catch (err: any) {
        console.error(`[Test 1 FAIL] Router did not fall over:`, err.message);
        throw err;
    }

    // Test 2: Global flow timeout via AbortSignal.
    // The entire flow is cancelled, so it MUST abort everything.
    console.log("\n[Test 2] Invoking with global AbortSignal aborting after 100ms...");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const t1 = Date.now();
    try {
        await router.invoke(
            [new HumanMessage("This should abort globally")],
            undefined,
            { signal: controller.signal }
        );
        assert.fail("Should have thrown global abort error!");
    } catch (err: any) {
        assert.strictEqual(err.message, "Request aborted by global timeout");
        console.log(`[Test 2 PASS] Correctly aborted globally in ${Date.now() - t1}ms with error: "${err.message}"`);
    }

    console.log("\nAll failover timeout tests PASSED successfully.");
}

runTimeoutTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
