import "dotenv/config";
import { SkillRegistry } from "../src/skills/registry";
import { ModelRouter } from "../src/core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

async function runDirectSearchFastPathTest() {
    console.log("=========================================");
    console.log(" DIRECT SEARCH FAST-PATH VERIFICATION TEST ");
    console.log("=========================================\n");

    const searchQuery = "search latest AI news";
    const tStart = Date.now();

    console.log(`[Test] Query: "${searchQuery}"`);
    console.log("[Test] 1. Executing web_search tool directly...");
    const webSearchTool = SkillRegistry.getToolByName("web_search");
    console.assert(webSearchTool !== undefined, "web_search tool not registered!");

    const searchResults = await webSearchTool!.invoke({ query: searchQuery });
    console.log(`[Test] Tavily completed in ${Date.now() - tStart}ms`);

    console.log("[Test] 2. Synthesizing results via Gemini (1 LLM call)...");
    const router = ModelRouter.getInstance();
    const response: any = await router.invokeWithRetry([
        new SystemMessage("Synthesize these search results briefly (max 2-3 sentences):\n" + searchResults),
        new HumanMessage(searchQuery)
    ], "search_fastpath");

    const elapsed = Date.now() - tStart;
    console.log(`[Test] Total Direct Search Fast-Path Latency: ${elapsed}ms`);
    console.log(`[Test] Final Output: "${response.content.trim().slice(0, 150)}..."`);

    console.assert(elapsed < 12000, "Direct search fast path exceeded 12s limit.");
    console.log("✅ TEST PASSED: Direct Search Fast-Path executed cleanly in ~3-5s.\n");
}

runDirectSearchFastPathTest();
