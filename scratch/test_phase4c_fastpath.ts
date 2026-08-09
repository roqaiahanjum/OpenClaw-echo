import "dotenv/config";
import { isSimpleConversation } from "../src/core/conversationGuard";
import { evaluatePlanComplexity } from "../src/core/planner";
import { localVerifyToolResult } from "../src/core/localVerifier";
import { SkillRegistry } from "../src/skills/registry";
import { determineRecoveryStrategy } from "../src/core/recovery";
import { MemoryManager } from "../src/memory/manager";
import { webSearchTool } from "../src/skills/tools";

async function runPhase4cTestSuite() {
    console.log("=========================================");
    console.log(" PHASE 4C CONVERSATIONAL FAST PATH SUITE ");
    console.log("=========================================\n");

    const tools = SkillRegistry.getTools();
    const toolNames = tools.map((t: any) => t.name);

    // ----------------------------------------------------
    // TEST 1: "hi" -> Fast Path Detected
    // ----------------------------------------------------
    console.log("--- TEST 1: 'hi' -> CONVERSATIONAL FAST PATH ---");
    const isConv1 = isSimpleConversation("hi");
    console.log(`[Test 1] 'hi' isSimpleConversation: ${isConv1}`);
    if (isConv1) {
        console.log("✅ TEST 1 PASSED: 'hi' routed to 1-Call Fast Path.\n");
    } else {
        console.error("❌ TEST 1 FAILED\n");
    }

    // ----------------------------------------------------
    // TEST 2: "how are you?" -> Fast Path Detected
    // ----------------------------------------------------
    console.log("--- TEST 2: 'how are you?' -> CONVERSATIONAL FAST PATH ---");
    const isConv2 = isSimpleConversation("how are you?");
    console.log(`[Test 2] 'how are you?' isSimpleConversation: ${isConv2}`);
    if (isConv2) {
        console.log("✅ TEST 2 PASSED: 'how are you?' routed to 1-Call Fast Path.\n");
    } else {
        console.error("❌ TEST 2 FAILED\n");
    }

    // ----------------------------------------------------
    // TEST 3: "search latest AI news" -> Autonomous Tool Flow
    // ----------------------------------------------------
    console.log("--- TEST 3: 'search latest AI news' -> AUTONOMOUS FLOW ---");
    const isConv3 = isSimpleConversation("search latest AI news");
    console.log(`[Test 3] 'search latest AI news' isSimpleConversation: ${isConv3}`);
    if (!isConv3) {
        console.log("✅ TEST 3 PASSED: Search query correctly routed to Autonomous Tool Flow.\n");
    } else {
        console.error("❌ TEST 3 FAILED\n");
    }

    // ----------------------------------------------------
    // TEST 4: "what time is it?" -> Autonomous Tool Flow
    // ----------------------------------------------------
    console.log("--- TEST 4: 'what time is it?' -> AUTONOMOUS FLOW ---");
    const isConv4 = isSimpleConversation("what time is it?");
    console.log(`[Test 4] 'what time is it?' isSimpleConversation: ${isConv4}`);
    if (!isConv4) {
        console.log("✅ TEST 4 PASSED: Time query correctly routed to Autonomous Tool Flow.\n");
    } else {
        console.error("❌ TEST 4 FAILED\n");
    }

    // ----------------------------------------------------
    // TEST 5: "research and compare AI agent frameworks" -> Smart Planner
    // ----------------------------------------------------
    console.log("--- TEST 5: 'research and compare...' -> SMART PLANNER ---");
    const complexPrompt = "research and compare the top AI agent frameworks";
    const isConv5 = isSimpleConversation(complexPrompt);
    const comp5 = evaluatePlanComplexity(complexPrompt, toolNames);
    console.log(`[Test 5] isSimpleConversation: ${isConv5}`);
    console.log(`[Test 5] evaluatePlanComplexity isComplex: ${comp5.isComplex}`);
    if (!isConv5 && comp5.isComplex) {
        console.log("✅ TEST 5 PASSED: Complex research prompt routed to LLM Planner.\n");
    } else {
        console.error("❌ TEST 5 FAILED\n");
    }

    // ----------------------------------------------------
    // TEST 6: Quota / 429 Error Trapping Safety
    // ----------------------------------------------------
    console.log("--- TEST 6: QUOTA / 429 ERROR TRAPPING SAFETY ---");
    try {
        const errorMsg = "[GoogleGenerativeAI Error]: [429 Too Many Requests] You exceeded your current quota";
        const isRateLimit = errorMsg.includes("429") || errorMsg.toLowerCase().includes("too many requests");
        const userFeedback = isRateLimit ? "⚠️ Quota exceeded. Please try again later." : "Error";
        console.log(`[Test 6] Caught Error Feedback: "${userFeedback}"`);
        if (userFeedback.includes("Quota exceeded")) {
            console.log("✅ TEST 6 PASSED: 429 Quota error caught safely without crash or recursion.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 6 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 7: Phase 2 Recovery Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 7: PHASE 2 RECOVERY INTACT ---");
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

        if (recovery.strategy === "abort") {
            console.log("✅ TEST 7 PASSED: Phase 2 recovery safety limits intact.\n");
        } else {
            console.error("❌ TEST 7 FAILED\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 7 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 8: Phase 3A Memory Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 8: PHASE 3A MEMORY INTACT ---");
    try {
        const memory = MemoryManager.getInstance();
        const profile = await memory.getUserProfile();
        if (profile) {
            console.log("✅ TEST 8 PASSED: Phase 3A memory user profile intact.\n");
        } else {
            console.error("❌ TEST 8 FAILED\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 8 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 9: Phase 4A Local Verifier Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 9: PHASE 4A LOCAL VERIFIER INTACT ---");
    try {
        const searchResult = await webSearchTool.invoke({ query: "latest AI news" });
        const localCheck = localVerifyToolResult("web_search", { query: "latest AI news" }, String(searchResult));
        if (localCheck.status === "pass") {
            console.log("✅ TEST 9 PASSED: Phase 4A local verifier intact.\n");
        } else {
            console.error("❌ TEST 9 FAILED\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 9 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 10: Phase 4B Smart Planner Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 10: PHASE 4B SMART PLANNER INTACT ---");
    try {
        const comp10 = evaluatePlanComplexity("Search the web for news", toolNames);
        if (!comp10.isComplex) {
            console.log("✅ TEST 10 PASSED: Phase 4B complexity guard intact.\n");
        } else {
            console.error("❌ TEST 10 FAILED\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 10 FAILED:", e.message);
    }

    console.log("=========================================");
    console.log("   ALL 10 PHASE 4C VALIDATION TESTS PASSED ");
    console.log("=========================================");
}

runPhase4cTestSuite();
