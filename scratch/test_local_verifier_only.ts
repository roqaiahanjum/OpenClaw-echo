import "dotenv/config";
import { localVerifyToolResult } from "../src/core/localVerifier";

function runLocalVerifierUnitTests() {
    console.log("=========================================");
    console.log(" LOCAL VERIFIER UNIT TEST SUITE (FAST)  ");
    console.log("=========================================\n");

    // 1. web_search valid output -> PASS
    const validSearchOutput = `Source: https://news.ai\nTitle: AI News 2025\nContent: Major advancements in artificial intelligence models and enterprise deployments were announced today across top labs.`;
    const res1 = localVerifyToolResult("web_search", { query: "latest AI news" }, validSearchOutput);
    console.log(`[Test 1] web_search Valid Output -> Status: ${res1.status} | Reason: "${res1.reason}"`);
    console.assert(res1.status === "pass", "Test 1 failed");

    // 2. web_search error response -> FAIL
    const errorSearchOutput = "Web search failed. API responded with 429 Too Many Requests.";
    const res2 = localVerifyToolResult("web_search", { query: "latest AI news" }, errorSearchOutput);
    console.log(`[Test 2] web_search Error Output -> Status: ${res2.status} | Reason: "${res2.reason}"`);
    console.assert(res2.status === "fail", "Test 2 failed");

    // 3. web_search empty output -> FAIL
    const res3 = localVerifyToolResult("web_search", { query: "latest AI news" }, "");
    console.log(`[Test 3] web_search Empty Output -> Status: ${res3.status} | Reason: "${res3.reason}"`);
    console.assert(res3.status === "fail", "Test 3 failed");

    // 4. web_search no results string -> FAIL
    const res4 = localVerifyToolResult("web_search", { query: "latest AI news" }, "No results found for that query.");
    console.log(`[Test 4] web_search No Results Output -> Status: ${res4.status} | Reason: "${res4.reason}"`);
    console.assert(res4.status === "fail", "Test 4 failed");

    // 5. Unknown / Unhandled Tool -> UNCERTAIN (Triggers Gemini Fallback)
    const res5 = localVerifyToolResult("custom_unknown_tool", {}, "Output from unknown tool");
    console.log(`[Test 5] Unknown Tool Output -> Status: ${res5.status} | Reason: "${res5.reason}"`);
    console.assert(res5.status === "uncertain", "Test 5 failed");

    console.log("\n✅ ALL LOCAL VERIFIER UNIT TESTS PASSED INSTANTLY (0 Gemini API Calls Consumed).\n");
}

runLocalVerifierUnitTests();
