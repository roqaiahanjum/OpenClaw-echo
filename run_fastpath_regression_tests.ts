import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";
import { GoalManager } from "./src/core/goals";

dotenv.config();

async function runRegressionTests() {
    console.log("=== REGRESSION TESTS: FAST-PATH ROUTING & TOOL DEPENDENCY ===");
    console.log("Initializing MemoryManager...");
    await MemoryManager.getInstance().initialize();

    let test1Passed = false;
    let test2Passed = false;

    // ----------------------------------------------------
    // TEST 1: Code Execution Prompt
    // Prompt: "Run this JavaScript: console.log(2+2)"
    // Must execute via write_sandbox_file + run_sandbox_code and return result 4.
    // ----------------------------------------------------
    console.log("\n----------------------------------------------------");
    console.log("Running Regression Test 1: Code Execution...");
    console.log("Prompt: 'Run this JavaScript: console.log(2+2)'");

    let test1Reply = "";
    const replyFn1 = async (text: string) => {
        test1Reply = text;
        console.log(`\n[Agent Reply 1] =>\n${text}\n`);
    };

    try {
        await executeAutonomousFlow("Run this JavaScript: console.log(2+2)", "test_chat_code_exec", false, replyFn1);
        
        const hasResult4 = test1Reply.includes("4");
        const hasInabilityClaim = test1Reply.toLowerCase().includes("can't execute") ||
                                  test1Reply.toLowerCase().includes("cannot execute") ||
                                  test1Reply.toLowerCase().includes("unable to execute");

        console.log(`- Contains result '4': ${hasResult4}`);
        console.log(`- Does NOT claim inability: ${!hasInabilityClaim}`);

        if (hasResult4 && !hasInabilityClaim) {
            console.log("✅ REGRESSION TEST 1 PASSED: Code executed and output contains 4.");
            test1Passed = true;
        } else {
            console.error(`❌ REGRESSION TEST 1 FAILED: Output did not contain expected result 4 or claimed inability. Output: "${test1Reply}"`);
        }
    } catch (e: any) {
        console.error("❌ REGRESSION TEST 1 EXCEPTION:", e.message);
    }

    // ----------------------------------------------------
    // TEST 2: Goals Management Prompt
    // Step A: "Add a goal: finish testing"
    // Step B: "What are my goals?"
    // Must call manage_project_goals and return the real goals containing "finish testing".
    // ----------------------------------------------------
    console.log("\n----------------------------------------------------");
    console.log("Running Regression Test 2: Goal Creation & Listing...");

    let addGoalReply = "";
    const replyFnAdd = async (text: string) => {
        addGoalReply = text;
        console.log(`\n[Agent Reply 2A (Add Goal)] =>\n${text}\n`);
    };

    try {
        console.log("Step 2A: Sending 'Add a goal: finish testing'...");
        await executeAutonomousFlow("Add a goal: finish testing", "test_chat_goals", false, replyFnAdd);

        let listGoalsReply = "";
        const replyFnList = async (text: string) => {
            listGoalsReply = text;
            console.log(`\n[Agent Reply 2B (List Goals)] =>\n${text}\n`);
        };

        console.log("Step 2B: Sending 'What are my goals?'...");
        await executeAutonomousFlow("What are my goals?", "test_chat_goals", false, replyFnList);

        const containsFinishTesting = listGoalsReply.toLowerCase().includes("finish testing") || listGoalsReply.toLowerCase().includes("finishing testing");
        console.log(`- Goals list contains 'finish testing': ${containsFinishTesting}`);

        if (containsFinishTesting) {
            console.log("✅ REGRESSION TEST 2 PASSED: Real goals returned and contains 'finish testing'.");
            test2Passed = true;
        } else {
            console.error(`❌ REGRESSION TEST 2 FAILED: Goals output did not contain 'finish testing'. Output: "${listGoalsReply}"`);
        }
    } catch (e: any) {
        console.error("❌ REGRESSION TEST 2 EXCEPTION:", e.message);
    }

    console.log("\n====================================================");
    if (test1Passed && test2Passed) {
        console.log("🏆 ALL REGRESSION TESTS PASSED!");
        process.exit(0);
    } else {
        console.error(`💥 REGRESSION FAILURES: Test 1: ${test1Passed ? "PASS" : "FAIL"} | Test 2: ${test2Passed ? "PASS" : "FAIL"}`);
        process.exit(1);
    }
}

runRegressionTests();
