import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs/promises";
import { executeAutonomousFlow } from "./src/integrations/telegram";
import { MemoryManager } from "./src/memory/manager";
import { SkillRegistry } from "./src/skills/registry";
import { SubAgentManager } from "./src/agents/SubAgentManager";
import { CodingSubAgent } from "./src/agents/workers/CodingSubAgent";
import { ModelRouter } from "./src/core/router";
import { isSafePublicUrl, scrapeWebsiteTool, writeSandboxFileTool } from "./src/skills/tools";
import { localVerifyToolResult } from "./src/core/localVerifier";
import { determineRecoveryStrategy } from "./src/core/recovery";
import { HumanMessage } from "@langchain/core/messages";

dotenv.config();

interface TestResult {
    testName: string;
    passed: boolean;
    evidence: string;
}

const testResults: TestResult[] = [];

function recordTest(testName: string, passed: boolean, evidence: string) {
    testResults.push({ testName, passed, evidence });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`\n========================================`);
    console.log(`[TEST]: ${testName} => ${mark}`);
    console.log(`[EVIDENCE]:\n${evidence}`);
    console.log(`========================================\n`);
}

async function runAllTests() {
    console.log(">>> STARTING OPENCLAW ECHO RELIABILITY TEST SUITE <<<\n");

    const memory = MemoryManager.getInstance();
    await memory.initialize();

    // ----------------------------------------------------
    // TEST 1: Basic Telegram Conversation
    // ----------------------------------------------------
    try {
        console.log("Running Test 1: Basic Telegram Conversation...");
        let reply = "";
        const replyFn = async (text: string) => {
            reply = text;
        };

        const testChatId = `test_chat_${Date.now()}`;
        await executeAutonomousFlow("Hello! What is your name?", testChatId, false, replyFn);

        const passed = reply.length > 0 && typeof reply === "string";
        recordTest(
            "Basic Telegram conversation",
            passed,
            `User query: "Hello! What is your name?"\nBot Reply (${reply.length} chars): "${reply.slice(0, 150)}..."`
        );
    } catch (e: any) {
        recordTest("Basic Telegram conversation", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 2: Conversation memory recall
    // ----------------------------------------------------
    try {
        console.log("Running Test 2: Conversation memory recall...");
        const memoryChatId = `mem_user_${Date.now()}`;
        const uniqueFactKey = `secret_project_codename_${Date.now().toString(36)}`;
        const uniqueFactVal = "Project Nebula Horizon";

        // Save unique fact to memory
        await memory.saveFact("project", uniqueFactKey, uniqueFactVal, 1.0);
        await memory.addInteraction("What is our project codename?", `It is ${uniqueFactVal}`, memoryChatId);

        // Retrieve context
        const context = await memory.getContext("What is our project codename?", memoryChatId);
        const recalled = context.includes(uniqueFactVal);

        recordTest(
            "Conversation memory recall",
            recalled,
            `Saved Fact: key="${uniqueFactKey}", value="${uniqueFactVal}"\nContext match found: ${recalled}\nContext snippet: "${context.slice(0, 200).replace(/\n/g, ' ')}..."`
        );
    } catch (e: any) {
        recordTest("Conversation memory recall", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 3: Genuine web search
    // ----------------------------------------------------
    try {
        console.log("Running Test 3: Genuine web search...");
        const webSearch = SkillRegistry.getToolByName("web_search");
        if (!webSearch) throw new Error("web_search tool not found in registry");

        const searchQuery = "Nobel Prize in Physics 2024 winners";
        const result = String(await webSearch.invoke({ query: searchQuery }));
        const hasUrlOrAnswer = result.includes("http") || result.includes("Hopfield") || result.includes("Hinton") || result.includes("Latest Search Updates");
        const hasContent = result.length > 50 && !result.toLowerCase().includes("fatal");

        recordTest(
            "Genuine web search",
            hasUrlOrAnswer && hasContent,
            `Query: "${searchQuery}"\nTool Output (${result.length} chars):\n${result.slice(0, 300)}...`
        );
    } catch (e: any) {
        recordTest("Genuine web search", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 4: Successful and failed website retrieval
    // ----------------------------------------------------
    try {
        console.log("Running Test 4: Successful and failed website retrieval...");
        // 4a: Successful scrape
        const successUrl = "https://example.com";
        const successOutput = String(await scrapeWebsiteTool.invoke({ url: successUrl }));
        const successOk = successOutput.includes("Example Domain") || successOutput.includes("illustrative examples");

        // 4b: Failed scrape (HTTP 404)
        const notFoundUrl = "https://example.com/non_existent_page_for_test_404";
        const notFoundOutput = String(await scrapeWebsiteTool.invoke({ url: notFoundUrl }));
        const failed404Ok = notFoundOutput.includes("HTTP Error 404") || notFoundOutput.includes("Failed to scrape");

        // 4c: SSRF blocked
        const ssrfUrl = "http://127.0.0.1:8080/admin";
        const ssrfOutput = String(await scrapeWebsiteTool.invoke({ url: ssrfUrl }));
        const ssrfBlocked = ssrfOutput.includes("Safety Error") || ssrfOutput.includes("SSRF guard");

        const passed = successOk && failed404Ok && ssrfBlocked;
        recordTest(
            "Successful and failed website retrieval",
            passed,
            `4a: Success: ${successUrl} => ${successOutput.slice(0, 100).replace(/\n/g, ' ')}\n` +
            `4b: 404 Error: ${notFoundUrl} => ${notFoundOutput}\n` +
            `4c: SSRF Guard: ${ssrfUrl} => ${ssrfOutput}`
        );
    } catch (e: any) {
        recordTest("Successful and failed website retrieval", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 5: TypeScript file creation inside the sandbox
    // ----------------------------------------------------
    let createdTsPath = "";
    try {
        console.log("Running Test 5: TypeScript file creation inside the sandbox...");
        const tsFileName = `calc_test_${Date.now()}.ts`;
        const tsContent = `// TypeScript calculation module
export function calculateFactorial(n: number): number {
    if (n <= 1) return 1;
    return n * calculateFactorial(n - 1);
}
console.log("Factorial(5) =", calculateFactorial(5));
`;
        const writeResult = String(await writeSandboxFileTool.invoke({ fileName: tsFileName, content: tsContent }));
        createdTsPath = path.resolve(process.cwd(), "src", "sandbox", tsFileName);

        const fileExists = await fs.stat(createdTsPath).then(s => s.isFile() && s.size > 0).catch(() => false);
        const containsVerified = writeResult.includes("Successfully created and verified") || writeResult.includes("bytes");

        recordTest(
            "TypeScript file creation inside the sandbox",
            fileExists && containsVerified,
            `File: src/sandbox/${tsFileName}\nTool Output: "${writeResult}"\nFile Exists on Disk: ${fileExists}`
        );
    } catch (e: any) {
        recordTest("TypeScript file creation inside the sandbox", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 6: File existence verification
    // ----------------------------------------------------
    try {
        console.log("Running Test 6: File existence verification...");
        // 6a: Existing file verification
        const existingStat = await fs.stat(createdTsPath);
        const readContent = await fs.readFile(createdTsPath, "utf-8");
        const existingVerified = existingStat.isFile() && readContent.includes("calculateFactorial");

        // 6b: Non-existent file verification
        const nonExistentPath = path.resolve(process.cwd(), "src", "sandbox", `non_existent_${Date.now()}.ts`);
        const nonExistentVerified = await fs.stat(nonExistentPath).then(() => false).catch(() => true);

        // 6c: Symlink / path traversal escape blocked
        const traversalResult = String(await writeSandboxFileTool.invoke({ fileName: "../../escaped.txt", content: "illegal" }));
        const traversalBlocked = traversalResult.includes("Safety Violation");

        const passed = existingVerified && nonExistentVerified && traversalBlocked;
        recordTest(
            "File existence verification",
            passed,
            `Existing File Verified: ${existingVerified} (${existingStat.size} bytes)\n` +
            `Non-Existent File Check: Verified Absent = ${nonExistentVerified}\n` +
            `Path Traversal Attempt ("../../escaped.txt"): ${traversalResult}`
        );
    } catch (e: any) {
        recordTest("File existence verification", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 7: CodingSubAgent delegation
    // ----------------------------------------------------
    try {
        console.log("Running Test 7: CodingSubAgent delegation...");
        const codingAgent = new CodingSubAgent();
        const taskId = `task_code_test_${Date.now()}`;
        const targetFileName = `factorial_sub_${Date.now()}.ts`;

        const acpTask = {
            taskId: taskId,
            parentId: "test_root",
            targetAgent: "coding" as const,
            taskDescription: `Create a TypeScript file in sandbox named ${targetFileName} that calculates factorial of 5`,
            contextPayload: { originalPrompt: `Create a TypeScript file in sandbox named ${targetFileName} that calculates factorial of 5` },
            maxDepth: 2
        };

        const result = await codingAgent.execute(acpTask);
        const subPath = path.resolve(process.cwd(), "src", "sandbox", targetFileName);
        const subFileOnDisk = await fs.stat(subPath).then(s => s.isFile()).catch(() => false);

        const hasSections = result.resultData.includes("### 1. Generated Code") &&
                            result.resultData.includes("### 2. Saved File Status") &&
                            result.resultData.includes("### 3. Execution Status");

        const passed = result.status === "SUCCESS" && subFileOnDisk && hasSections;
        recordTest(
            "CodingSubAgent delegation",
            passed,
            `Status: ${result.status}\n` +
            `File Verified on Disk: src/sandbox/${targetFileName} => ${subFileOnDisk}\n` +
            `3 Distinct Sections Present: ${hasSections}\n` +
            `Output Excerpt:\n${result.resultData.slice(0, 350)}...`
        );
    } catch (e: any) {
        recordTest("CodingSubAgent delegation", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 8: LLM timeout and fallback
    // ----------------------------------------------------
    try {
        console.log("Running Test 8: LLM timeout and fallback...");
        const router = ModelRouter.getInstance();

        // Test 8a: Verify timeout abort with an already aborted signal
        const abortedController = new AbortController();
        abortedController.abort();

        let caughtAbort = false;
        try {
            await router.invoke([new HumanMessage("Test")], "simple", { signal: abortedController.signal });
        } catch (err: any) {
            caughtAbort = err.message.includes("aborted") || err.message.includes("timeout");
        }

        // Test 8b: Verify circuit breaker fallback mode
        router.tripCircuitBreakerForModel("groq-fast");
        router.tripCircuitBreakerForModel("gemini-flash");
        router.tripCircuitBreakerForModel("groq-backup");
        router.tripCircuitBreakerForModel("gemini-fallback");

        const inFallback = router.isInFallbackMode();
        const fallbackRes = await router.invokeWithRetry([new HumanMessage("Test")], "simple", {}, 1);
        const fallbackHandled = fallbackRes && typeof fallbackRes.content === "string" && fallbackRes.content.includes("All upstream AI providers are currently unreachable");

        // Clean up: reset circuit breaker
        router.resetCircuitBreaker();
        const restored = !router.isInFallbackMode();

        const passed = caughtAbort && inFallback && fallbackHandled && restored;
        recordTest(
            "LLM timeout and fallback",
            passed,
            `Abort Signal Handled Promptly: ${caughtAbort}\n` +
            `Circuit Breaker Triggered Fallback Mode: ${inFallback}\n` +
            `Graceful Degradation Returned: "${fallbackRes?.content}"\n` +
            `Circuit Breaker Clean Reset: ${restored}`
        );
    } catch (e: any) {
        recordTest("LLM timeout and fallback", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 9: Duplicate reply prevention
    // ----------------------------------------------------
    try {
        console.log("Running Test 9: Duplicate reply prevention...");
        let dispatchCount = 0;
        const repliesReceived: string[] = [];

        const countingReplyFn = async (msg: string) => {
            dispatchCount++;
            repliesReceived.push(msg);
        };

        const dupChatId = `dup_test_${Date.now()}`;
        // Execute a fast greeting flow
        await executeAutonomousFlow("hello", dupChatId, false, countingReplyFn);

        // Verify that only 1 reply was dispatched
        const singleReplySent = dispatchCount === 1;

        // Also test the cancellation guard: if parentSignal is aborted, safeReply must reject further dispatches
        const cancelController = new AbortController();
        let cancelledDispatches = 0;
        const cancelReplyFn = async (msg: string) => {
            cancelledDispatches++;
        };
        cancelController.abort(); // already cancelled

        await executeAutonomousFlow("hello after cancel", `cancel_${Date.now()}`, false, cancelReplyFn, undefined, false, cancelController.signal);
        const zeroSentAfterCancel = cancelledDispatches === 0;

        const passed = singleReplySent && zeroSentAfterCancel;
        recordTest(
            "Duplicate reply prevention",
            passed,
            `Normal flow replies sent: ${dispatchCount} (expected 1)\n` +
            `Replies sent after cancellation: ${cancelledDispatches} (expected 0)\n` +
            `Reply text received: "${repliesReceived[0]?.slice(0, 100)}"`
        );
    } catch (e: any) {
        recordTest("Duplicate reply prevention", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // TEST 10: Recovery after a failed tool call
    // ----------------------------------------------------
    try {
        console.log("Running Test 10: Recovery after a failed tool call...");
        // 10a: Local verifier identifies failure
        const badOutput = "Error: File does not exist on disk";
        const verification = localVerifyToolResult("local_file_system", { action: "read", path: "nonexistent.txt" }, badOutput);
        const failureDetected = verification.status === "fail";

        // 10b: Recovery strategy engine selects a valid recovery strategy
        const recoveryDecision = await determineRecoveryStrategy({
            userGoal: "Read project configuration",
            toolName: "local_file_system",
            toolArgs: { action: "read", path: "nonexistent.txt" },
            output: badOutput,
            failureReason: verification.reason,
            availableTools: ["local_file_system", "web_search"],
            attemptCount: 1
        });

        const strategySelected = ["modify_args", "alternative_tool", "retry_same", "replan", "abort"].includes(recoveryDecision.strategy);

        // 10c: Autonomous flow executes cleanly even when a tool fails and self-recovers
        let flowReply = "";
        const testRecoveryChatId = `recov_${Date.now()}`;
        // Prompting something that might attempt reading and then recover
        await executeAutonomousFlow("Check if file xyz_dummy_123.txt exists and tell me", testRecoveryChatId, false, async (t: string) => {
            flowReply = t;
        });

        const flowRecoveredCleanly = flowReply.length > 0;
        const passed = failureDetected && strategySelected && flowRecoveredCleanly;

        recordTest(
            "Recovery after a failed tool call",
            passed,
            `10a: Verifier detected failure: ${failureDetected} (Status: ${verification.status}, Reason: "${verification.reason}")\n` +
            `10b: Recovery decision selected: strategy="${recoveryDecision.strategy}", reason="${recoveryDecision.reason}"\n` +
            `10c: Agent flow completed cleanly with final answer: "${flowReply.slice(0, 150).replace(/\n/g, ' ')}..."`
        );
    } catch (e: any) {
        recordTest("Recovery after a failed tool call", false, `Exception: ${e.message}`);
    }

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log("\n========================================");
    console.log("            TEST RESULTS SUMMARY        ");
    console.log("========================================");
    let allPassed = true;
    for (const res of testResults) {
        const mark = res.passed ? "✅ PASS" : "❌ FAIL";
        console.log(`${mark} | ${res.testName}`);
        if (!res.passed) allPassed = false;
    }
    console.log("========================================");
    console.log(`TOTAL: ${testResults.filter(r => r.passed).length}/${testResults.length} PASSED`);
    console.log("========================================\n");
}

runAllTests().then(() => process.exit(0)).catch(err => {
    console.error("FATAL SUITE ERROR:", err);
    process.exit(1);
});
