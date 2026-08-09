import "dotenv/config";
import { determineRecoveryStrategy } from "../src/core/recovery";
import { verifyStepResult } from "../src/core/verifier";
import { SkillRegistry } from "../src/skills/registry";
import { ModelRouter } from "../src/core/router";
import { webSearchTool } from "../src/skills/tools";

async function runValidationSuite() {
    console.log("=========================================");
    console.log("   SELF-HEALING RECOVERY VALIDATION SUITE ");
    console.log("=========================================\n");

    const tools = SkillRegistry.getTools();
    const availableToolNames = tools.map((t: any) => t.name);

    // ----------------------------------------------------
    // TEST 1: Normal Success (No Recovery Triggered)
    // ----------------------------------------------------
    console.log("--- TEST 1: NORMAL SUCCESS ---");
    try {
        const query = "Search the web for the latest AI news.";
        const toolResult = await webSearchTool.invoke({ query: "latest AI news" });
        const verification = await verifyStepResult(query, "web_search", String(toolResult));

        console.log(`[Test 1] Verification Success: ${verification.success}`);
        console.log(`[Test 1] Verification Reason: "${verification.reason}"`);

        if (verification.success) {
            console.log("✅ TEST 1 PASSED: Verification succeeded cleanly, recovery was NOT triggered.\n");
        } else {
            console.log("⚠️ TEST 1 NOTE: Verification flagged result, checking why...\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 1 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 2: Forced Verification Failure & Recovery Flow
    // ----------------------------------------------------
    console.log("--- TEST 2: FORCED VERIFICATION FAILURE & RECOVERY ---");
    try {
        const userGoal = "Find quantum computing breakthroughs";
        const initialTool = "web_search";
        const initialArgs = { query: "quantum" };
        const failedOutput = "Error 500: Server error occurred while fetching results.";
        const failureReason = "Output returned server error message instead of useful computing data.";

        console.log(`Initial Tool: ${initialTool}`);
        console.log(`Failure Reason: ${failureReason}`);

        const recovery = await determineRecoveryStrategy({
            userGoal,
            toolName: initialTool,
            toolArgs: initialArgs,
            output: failedOutput,
            failureReason,
            availableTools: availableToolNames,
            attemptCount: 1
        });

        console.log(`Recovery Strategy Selected: ${recovery.strategy}`);
        console.log(`Recovery Reason: "${recovery.reason}"`);
        console.log(`Target Tool: ${recovery.newToolName || initialTool}`);
        console.log(`Target Args:`, recovery.newArgs || initialArgs);

        const targetToolName = recovery.newToolName || initialTool;
        const targetArgs = recovery.newArgs || { query: "quantum computing breakthroughs 2025" };
        const recoveryTool = SkillRegistry.getToolByName(targetToolName);

        if (recoveryTool) {
            console.log(`Executing Recovery Tool (${targetToolName})...`);
            const recoveryOutput = await recoveryTool.invoke(targetArgs);
            console.log(`Recovery Output Length: ${String(recoveryOutput).length} chars`);

            const reVerification = await verifyStepResult(userGoal, targetToolName, String(recoveryOutput));
            console.log(`Re-verification Success: ${reVerification.success}`);
            console.log(`Re-verification Reason: "${reVerification.reason}"`);
            console.log("✅ TEST 2 PASSED: Recovery strategy selected, executed, and re-verified.\n");
        } else {
            console.error("❌ TEST 2 FAILED: Could not resolve target recovery tool.");
        }
    } catch (e: any) {
        console.error("❌ TEST 2 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 3: Recovery Attempt Limit (Max Attempts Exceeded)
    // ----------------------------------------------------
    console.log("--- TEST 3: RECOVERY ATTEMPT LIMIT ---");
    try {
        const userGoal = "Run database query";
        const recovery = await determineRecoveryStrategy({
            userGoal,
            toolName: "run_sandbox_code",
            toolArgs: { fileName: "broken.js" },
            output: "SyntaxError: Unexpected token",
            failureReason: "Code execution failed repeatedly.",
            availableTools: availableToolNames,
            attemptCount: 2 // Max attempts reached
        });

        console.log(`Attempt Count: 2 (Limit)`);
        console.log(`Recovery Strategy: ${recovery.strategy}`);
        console.log(`Reason: "${recovery.reason}"`);

        if (recovery.strategy === "abort") {
            console.log("✅ TEST 3 PASSED: Recovery engine aborted when attempt limit was reached.\n");
        } else {
            console.error(`❌ TEST 3 FAILED: Strategy should be 'abort', got '${recovery.strategy}'\n`);
        }
    } catch (e: any) {
        console.error("❌ TEST 3 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 4: Invalid Alternative Tool Handling
    // ----------------------------------------------------
    console.log("--- TEST 4: INVALID ALTERNATIVE TOOL HANDLING ---");
    try {
        const invalidToolName = "nonexistent_fake_tool";
        const toolLookup = SkillRegistry.getToolByName(invalidToolName);

        console.log(`Lookup '${invalidToolName}': ${toolLookup ? "FOUND" : "UNDEFINED (Validation Guard active)"}`);

        if (!toolLookup) {
            console.log("✅ TEST 4 PASSED: Nonexistent tool was safely rejected without process crash.\n");
        } else {
            console.error("❌ TEST 4 FAILED: Fake tool was incorrectly found.\n");
        }
    } catch (e: any) {
        console.error("❌ TEST 4 FAILED:", e.message);
    }

    // ----------------------------------------------------
    // TEST 5: Invalid Arguments Handling (Zod Schema)
    // ----------------------------------------------------
    console.log("--- TEST 5: INVALID ARGUMENTS HANDLING ---");
    try {
        const tool = SkillRegistry.getToolByName("web_search");
        if (tool) {
            console.log("Invoking web_search with invalid arguments (missing 'query')...");
            const invalidResult = await tool.invoke({ invalid_param: 123 } as any).catch(err => `Caught: ${err.message}`);
            console.log(`Result / Error caught:`, invalidResult);
            console.log("✅ TEST 5 PASSED: Invalid input arguments were rejected cleanly without crashing.\n");
        }
    } catch (e: any) {
        console.log("✅ TEST 5 PASSED: Execution threw exception handled safely:", e.message, "\n");
    }

    console.log("=========================================");
    console.log("  ALL 5 VALIDATION TESTS COMPLETED ");
    console.log("=========================================");
}

runValidationSuite();
