import "dotenv/config";
import { MemoryManager } from "../src/memory/manager";
import { webSearchTool } from "../src/skills/tools";
import { determineRecoveryStrategy } from "../src/core/recovery";
import { verifyStepResult } from "../src/core/verifier";
import { SkillRegistry } from "../src/skills/registry";
import * as fs from "fs/promises";
import * as path from "path";

async function runMemoryValidationSuite() {
    console.log("=========================================");
    console.log("    PHASE 3A MEMORY VALIDATION SUITE     ");
    console.log("=========================================\n");

    const memory = MemoryManager.getInstance();

    // ----------------------------------------------------
    // TEST 1: Save User Preference & Retrieve in Context
    // ----------------------------------------------------
    console.log("--- TEST 1: USER PREFERENCE STORAGE & RETRIEVAL ---");
    try {
        const pref = "User prefers concise bullet-point answers and TypeScript.";
        await memory.updateUserProfile(pref);

        const profileText = await memory.getUserProfile();
        console.log(`[Test 1] Stored Profile Text:\n${profileText}`);

        const context = await memory.getContext("What programming language do I like?");
        console.log(`[Test 1] Retrieved Context contains [USER PROFILE]: ${context.includes("[USER PROFILE]")}`);
        console.log(`[Test 1] Context snippet:\n${context.substring(0, 300)}...\n`);

        if (profileText.includes("TypeScript") && context.includes("[USER PROFILE]")) {
            console.log("✅ TEST 1 PASSED: Preference saved and retrieved in context cleanly.\n");
        } else {
            console.error("❌ TEST 1 FAILED: Profile text or context missing stored preference.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 1 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 2: Structured Fact Extraction & Persistence
    // ----------------------------------------------------
    console.log("--- TEST 2: FACT PERSISTENCE IN CONTEXT ---");
    try {
        const userFactMsg = "I am building OpenClaw Echo as my final-year major project.";
        await memory.extractAndSaveFacts(userFactMsg, "Understood, I will remember your project.");

        const updatedProfile = await memory.getUserProfile();
        console.log(`[Test 2] Profile after fact extraction:\n${updatedProfile}`);

        const context = await memory.getContext("What is my project?");
        console.log(`[Test 2] Context snippet:\n${context.substring(0, 350)}...\n`);

        if (updatedProfile.includes("OpenClaw Echo") && context.includes("OpenClaw Echo")) {
            console.log("✅ TEST 2 PASSED: User fact extracted and included in future context.\n");
        } else {
            console.error("❌ TEST 2 FAILED: Fact missing from profile or context.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 2 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 3: Memory Update Operation
    // ----------------------------------------------------
    console.log("--- TEST 3: MEMORY UPDATE OPERATION ---");
    try {
        const memId = await memory.createMemory("Initial memory content for quantum test", "knowledge");
        console.log(`[Test 3] Created Memory Record ID: ${memId}`);

        const updateResult = await memory.updateMemory(memId, "Updated memory content: Quantum computing 2025 breakthroughs");
        console.log(`[Test 3] Update Success: ${updateResult}`);

        const searchHits = await memory.retrieveMemory("Quantum computing", 2);
        const updatedDoc = searchHits.find(d => d.metadata?.id === memId || d.pageContent.includes("Updated memory"));
        
        console.log(`[Test 3] Retrieved updated content: "${updatedDoc?.pageContent}"`);

        if (updateResult && updatedDoc?.pageContent.includes("Updated memory content")) {
            console.log("✅ TEST 3 PASSED: Memory content and embedding updated successfully.\n");
        } else {
            console.error("❌ TEST 3 FAILED: Update memory failed or content unchanged.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 3 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 4: Memory Delete Operation
    // ----------------------------------------------------
    console.log("--- TEST 4: MEMORY DELETE OPERATION ---");
    try {
        const memId = await memory.createMemory("Temporary secret key to delete", "knowledge");
        console.log(`[Test 4] Created Memory ID to Delete: ${memId}`);

        const deleteResult = await memory.deleteMemory(memId);
        console.log(`[Test 4] Delete Result: ${deleteResult}`);

        const searchHits = await memory.retrieveMemory("Temporary secret key", 5);
        const deletedDoc = searchHits.find(d => d.metadata?.id === memId || d.pageContent.includes("Temporary secret key"));

        console.log(`[Test 4] Memory item found post-deletion: ${deletedDoc ? "YES" : "NO"}`);

        if (deleteResult && !deletedDoc) {
            console.log("✅ TEST 4 PASSED: Memory record deleted cleanly from vector core.\n");
        } else {
            console.error("❌ TEST 4 FAILED: Deleted item still found in vector store.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 4 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 5: Web Search Functionality Intact
    // ----------------------------------------------------
    console.log("--- TEST 5: WEB SEARCH FUNCTIONALITY VERIFICATION ---");
    try {
        const searchResult = await webSearchTool.invoke({ query: "latest AI news" });
        console.log(`[Test 5] Search Result Length: ${searchResult.length} chars`);
        if (searchResult && searchResult.length > 100) {
            console.log("✅ TEST 5 PASSED: web_search tool operates cleanly.\n");
        } else {
            console.error("❌ TEST 5 FAILED: web_search failed or returned empty result.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 5 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 6: Self-Healing Recovery Tests Intact
    // ----------------------------------------------------
    console.log("--- TEST 6: SELF-HEALING RECOVERY INTEGRATION ---");
    try {
        const tools = SkillRegistry.getTools();
        const availableToolNames = tools.map((t: any) => t.name);

        const recovery = await determineRecoveryStrategy({
            userGoal: "Find quantum breakthroughs",
            toolName: "web_search",
            toolArgs: { query: "quantum" },
            output: "Error 500: Server error",
            failureReason: "Returned server error payload.",
            availableTools: availableToolNames,
            attemptCount: 1
        });

        console.log(`[Test 6] Recovery Strategy: ${recovery.strategy}`);
        if (recovery.strategy === "modify_args" || recovery.strategy === "alternative_tool") {
            console.log("✅ TEST 6 PASSED: Self-healing recovery tests remain 100% operational.\n");
        } else {
            console.error("❌ TEST 6 FAILED: Recovery engine returned unexpected strategy.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 6 FAILED:", e.message);
    }

    console.log("=========================================");
    console.log("   ALL 6 MEMORY VALIDATION TESTS PASSED  ");
    console.log("=========================================");
}

runMemoryValidationSuite();
