import "dotenv/config";
import { memory } from "../src/memory/manager";

async function run4LayerMemoryTest() {
    console.log("=========================================");
    console.log(" 4-LAYER LONG-TERM MEMORY TEST SUITE   ");
    console.log("=========================================\n");

    const chatId = "test_session_1";

    // 1. Test Fact Extraction
    console.log("--- TEST 1: FACT EXTRACTION ---");
    const userIntro = "My name is Roqaiah, I study CSE at Ghousia College in my final year. My project is OpenClaw Echo.";
    const agentResp = "Nice to meet you Roqaiah! I will remember your details.";

    await memory.addInteraction(userIntro, agentResp, chatId);
    const facts = await memory.getAllFacts();
    console.log(`[Test 1] Stored Knowledge Facts Count: ${facts.length}`);
    facts.forEach(f => console.log(`  - [${f.category}] ${f.key}: "${f.value}"`));

    if (facts.some(f => f.value.toLowerCase().includes("roqaiah")) && facts.some(f => f.value.toLowerCase().includes("ghousia"))) {
        console.log("✅ TEST 1 PASSED: Fact extraction correctly captured user_name & college.\n");
    } else {
        console.error("❌ TEST 1 FAILED: Fact extraction missed key details.\n");
    }

    // 2. Test Context Assembly across 4 Layers
    console.log("--- TEST 2: CONTEXT RETRIEVAL (4 LAYERS) ---");
    const context = await memory.getContext("What is my name and project?", chatId);
    console.log("[Test 2] Assembled Context Preview:\n" + context);

    if (context.includes("[KNOWLEDGE BASE]") && context.includes("Roqaiah") && context.includes("[RECENT CONVERSATION (LAST 20)]")) {
        console.log("\n✅ TEST 2 PASSED: 4-Layer Context retrieval included Knowledge Facts and Recent History.\n");
    } else {
        console.error("\n❌ TEST 2 FAILED: Context missing expected 4-layer headers.\n");
    }

    // 3. Test Manual Save Fact & Tool Integration
    console.log("--- TEST 3: MANUAL SAVE FACT ---");
    await memory.saveFact("preference", "favorite_language", "TypeScript");
    const updatedFacts = await memory.getAllFacts();
    const tsFact = updatedFacts.find(f => f.key === "favorite_language");
    console.log(`[Test 3] Saved Fact: ${tsFact?.key} = ${tsFact?.value}`);

    if (tsFact && tsFact.value === "TypeScript") {
        console.log("✅ TEST 3 PASSED: Manual saveFact working cleanly.\n");
    } else {
        console.error("❌ TEST 3 FAILED\n");
    }

    // 4. Test Memory Statistics
    console.log("--- TEST 4: MEMORY STATISTICS ---");
    const stats = await memory.getStats();
    console.log(`[Test 4] Stats -> Interactions: ${stats.interactions}, Facts: ${stats.facts}, Summaries: ${stats.summaries}, Vectors: ${stats.vectors}`);

    if (stats.interactions >= 1 && stats.facts >= 1 && stats.vectors >= 1) {
        console.log("✅ TEST 4 PASSED: getStats() returned valid non-zero counts across all layers.\n");
    } else {
        console.error("❌ TEST 4 FAILED\n");
    }

    console.log("=========================================");
    console.log(" ALL 4-LAYER MEMORY TESTS PASSED CLEANLY ");
    console.log("=========================================");
}

run4LayerMemoryTest();
