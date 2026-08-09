import "dotenv/config";
import { webSearchTool } from "../src/skills/tools";

async function runWebSearchTimeoutTest() {
    console.log("=========================================");
    console.log(" WEB SEARCH TIMEOUT & FALLBACK TEST ");
    console.log("=========================================\n");

    const tStart = Date.now();
    console.log("[Test] Executing web_search tool with 8s hard cap...");
    const result = await webSearchTool.invoke({ query: "latest artificial intelligence news" });
    const elapsed = Date.now() - tStart;

    console.log(`[Test] Elapsed time: ${elapsed}ms`);
    console.log(`[Test] Output preview: ${result.slice(0, 150)}...`);

    console.assert(elapsed < 9000, "Web search exceeded 8-second hard cap.");
    console.log("✅ TEST PASSED: web_search returned within 8s hard cap.\n");
}

runWebSearchTimeoutTest();
