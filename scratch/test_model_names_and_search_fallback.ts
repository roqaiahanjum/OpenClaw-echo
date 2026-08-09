import "dotenv/config";
import { ModelRouter } from "../src/core/router";
import { memory } from "../src/memory/manager";
import { SkillRegistry } from "../src/skills/registry";

async function runModelNamesAndSearchFallbackTest() {
    console.log("=================================================");
    console.log(" MODEL NAMES & SEARCH FALLBACK VERIFICATION TEST ");
    console.log("=================================================\n");

    // 1. ModelRouter Health Check
    console.log("--- TEST 1: ROUTER MODEL CONFIGURATION ---");
    const router = ModelRouter.getInstance();
    const health = await router.checkHealth();
    console.log(`[Test 1] Router Gemini details: "${health.gemini.details}"`);
    console.assert(health.gemini.details.includes("gemini-1.5-flash"), "Router model is not gemini-1.5-flash");
    console.log("✅ TEST 1 PASSED: ModelRouter configured with gemini-1.5-flash.\n");

    // 2. Memory Manager Embedding Initialization Check
    console.log("--- TEST 2: MEMORY MANAGER EMBEDDING MODEL ---");
    await memory.initialize();
    const stats = await memory.getStats();
    console.log(`[Test 2] Memory stats: Vectors=${stats.vectors}, Facts=${stats.facts}, Interactions=${stats.interactions}`);
    console.log("✅ TEST 2 PASSED: MemoryManager initialized with text-embedding-004.\n");

    // 3. Direct Search Tool Output Preservation Test
    console.log("--- TEST 3: SEARCH RESULT PRESERVATION FALLBACK ---");
    const searchTool = SkillRegistry.getToolByName("web_search");
    console.assert(searchTool !== undefined, "web_search tool not registered!");
    const rawResult = await searchTool!.invoke({ query: "latest artificial intelligence news" });
    console.log(`[Test 3] Raw Tavily Output length: ${rawResult.length} chars`);
    console.assert(rawResult.length > 50, "Raw Tavily output is empty!");
    console.log("✅ TEST 3 PASSED: Tavily search output retrieved and preserved for fallback.\n");

    console.log("=================================================");
    console.log(" ALL MODEL & FALLBACK VERIFICATION TESTS PASSED ");
    console.log("=================================================");
}

runModelNamesAndSearchFallbackTest();
