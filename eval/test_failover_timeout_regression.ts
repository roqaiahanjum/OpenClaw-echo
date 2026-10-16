/**
 * Failover Timeout Regression Test
 *
 * ROOT CAUSE OF HISTORICAL BUG (old eval_failover.ts):
 * ──────────────────────────────────────────────────────
 * The old harness created a short-lived AbortController and passed its signal
 * directly as `options.signal`, e.g.:
 *
 *   const ac = new AbortController();
 *   setTimeout(() => ac.abort(), 100);
 *   await router.invoke(messages, undefined, { signal: ac.signal });
 *
 * In router.ts `invoke()`:
 *   if (options?.signal?.aborted) throw new Error("Request aborted by global timeout");
 *
 * Because `options.signal` WAS the short-lived timeout signal, after 100ms the
 * signal was aborted. The next iteration of the waterfall for-loop checked
 * `options.signal.aborted` and threw "Request aborted by global timeout" —
 * aborting the ENTIRE waterfall instead of falling back to Gemini.
 *
 * CORRECT DESIGN (current router.ts):
 * ────────────────────────────────────
 * - `options.signal` = global cancellation only (user pressing stop, request timeout)
 * - `options.primaryTimeoutMs` = per-provider Groq timeout only; fires a local
 *   AbortController inside invokeProvider() and throws ProviderTimeoutError,
 *   which the waterfall catches and falls over to the next provider.
 *   It does NOT abort `options.signal`.
 *
 * This test verifies:
 * 1. A 150ms primaryTimeoutMs causes Groq to fail with ProviderTimeoutError
 *    and the router falls back to Gemini (RECOVERED).
 * 2. A real AbortController on options.signal with short timeout aborts the
 *    whole waterfall (GLOBAL_ABORT — expected behavior).
 */

import { ModelRouter } from "../src/core/router";
import { HumanMessage } from "@langchain/core/messages";

async function runTimeoutRegressionTest() {
    console.log("=== FAILOVER TIMEOUT REGRESSION TEST ===\n");

    const router = ModelRouter.getInstance();
    router.resetCircuitBreaker();

    // ── TEST 1: Per-provider timeout MUST fall back, NOT abort globally ──────
    console.log("Test 1: primaryTimeoutMs=150 on Groq Fast → expect RECOVERED via Gemini fallback");
    const t1 = Date.now();
    let test1Result = "FAIL";
    let test1Error = "";
    try {
        const resp = await router.invoke(
            [new HumanMessage("Say OK in one word.")],
            undefined,
            { primaryTimeoutMs: 150 }
        );
        if (resp && resp.content) {
            test1Result = "RECOVERED";
        }
    } catch (err: any) {
        test1Error = err.message;
        if (err.message.includes("Request aborted by global timeout")) {
            test1Result = "BUG: global timeout triggered by per-provider timeout";
        } else if (err.message.includes("All upstream AI providers")) {
            test1Result = "ALL_EXHAUSTED (Gemini also failed)";
        }
    }
    const t1ms = Date.now() - t1;
    console.log(`  Result: ${test1Result} in ${t1ms}ms${test1Error ? " | Error: " + test1Error : ""}`);
    const test1Pass = test1Result === "RECOVERED";
    console.log(`  Status: ${test1Pass ? "✅ PASS" : "❌ FAIL"} — Per-provider timeout ${test1Pass ? "correctly falls back to Gemini" : "incorrectly aborted the waterfall"}\n`);

    router.resetCircuitBreaker();
    await new Promise(res => setTimeout(res, 2000)); // brief pause

    // ── TEST 2: Real global AbortController MUST abort entire waterfall ───────
    console.log("Test 2: AbortController signal (500ms) on options.signal → expect GLOBAL_ABORT");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);
    const t2 = Date.now();
    let test2Result = "FAIL";
    let test2Error = "";
    try {
        await router.invoke(
            [new HumanMessage("Say OK in one word.")],
            undefined,
            { signal: ac.signal }
        );
        test2Result = "NOT_ABORTED (unexpected success)";
    } catch (err: any) {
        test2Error = err.message;
        if (
            err.message.includes("Request aborted by global timeout") ||
            err.message.includes("Request aborted before starting provider") ||
            err.message.includes("AbortError") ||
            err.message.includes("aborted")
        ) {
            test2Result = "GLOBAL_ABORT";
        } else {
            test2Result = "OTHER_ERROR: " + err.message;
        }
    }
    const t2ms = Date.now() - t2;
    console.log(`  Result: ${test2Result} in ${t2ms}ms${test2Error ? " | Error: " + test2Error : ""}`);
    const test2Pass = test2Result === "GLOBAL_ABORT" && t2ms < 3000;
    console.log(`  Status: ${test2Pass ? "✅ PASS" : "❌ FAIL"} — Global signal ${test2Pass ? "correctly aborted waterfall" : "did not abort as expected"}\n`);

    // ── SUMMARY ─────────────────────────────────────────────────────────────
    console.log("=== SUMMARY ===");
    console.log(`Test 1 (per-provider timeout → failover): ${test1Pass ? "PASS" : "FAIL"}`);
    console.log(`Test 2 (global signal → abort):           ${test2Pass ? "PASS" : "FAIL"}`);

    const allPass = test1Pass && test2Pass;
    console.log(`\nOverall: ${allPass ? "✅ ALL PASS" : "❌ FAILURES DETECTED"}`);

    if (!allPass) {
        process.exit(1);
    }
}

runTimeoutRegressionTest().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});
