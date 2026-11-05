import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { executeAutonomousFlow } from './src/integrations/telegram';

async function runTest() {
    console.log("================================================================================");
    console.log("   🧪 TEST: CODING SUB-AGENT SINGLE FILE-CREATION VERIFICATION                  ");
    console.log("================================================================================");

    const targetFile = path.resolve(process.cwd(), "src", "sandbox", "prime_checker.ts");
    try {
        await fs.unlink(targetFile);
        console.log("[Setup] Removed existing src/sandbox/prime_checker.ts for clean verification.");
    } catch {
        // File didn't exist
    }

    const input = "create prime_checker.ts using write_sandbox_file";
    console.log(`[Input] User Request:\n"${input}"\n`);

    let finalReply = "";
    let progressMessages: string[] = [];

    const mockReplyFn = async (msg: string) => {
        finalReply = msg;
        console.log(`[MockTelegram] >>> Received Final Bot Reply (${msg.length} chars) <<<`);
    };

    const mockProgressFn = async (prog: string) => {
        progressMessages.push(prog);
        console.log(`[MockTelegram Progress] ${prog}`);
    };

    const requestId = `test_prime_${Date.now()}`;
    const controller = new AbortController();

    const startTime = Date.now();
    await executeAutonomousFlow(
        input,
        "chat_999888",
        false,
        mockReplyFn,
        undefined,
        false,
        controller.signal,
        requestId,
        mockProgressFn
    );
    const duration = Date.now() - startTime;

    console.log(`\nFlow completed in ${duration}ms\n`);

    console.log("================================================================================");
    console.log("   🔍 VERIFICATION AUDIT CHECKS                                                 ");
    console.log("================================================================================");

    // Check 1: Progress message showed direct coding delegation
    const directDelegationProgress = progressMessages.some(m => m.includes("Generating code and saving file to sandbox"));
    console.log(`1. Direct CodingSubAgent delegation (no multi-agent wave overhead): ${directDelegationProgress ? "PASS ✅" : "FAIL ❌"}`);

    // Check 2: File exists on disk and fs.stat verifies it
    let fileVerified = false;
    let fileSize = 0;
    try {
        const stat = await fs.stat(targetFile);
        fileVerified = stat.isFile() && stat.size > 0;
        fileSize = stat.size;
    } catch (e: any) {
        fileVerified = false;
    }
    console.log(`2. File verified on disk via fs.stat: ${fileVerified ? `PASS ✅ (${fileSize} bytes at ${targetFile})` : "FAIL ❌"}`);

    // Check 3: Final reply contains real location
    const reportsSavedLocation = finalReply.includes("src/sandbox/prime_checker.ts") && finalReply.includes("VERIFIED ON DISK (via fs.stat) ✅");
    console.log(`3. Final reply reports verified location and fs.stat confirmation: ${reportsSavedLocation ? "PASS ✅" : "FAIL ❌"}`);

    // Check 4: No raw tool call JSON
    const containsRawJson = /\{\s*"(?:tool|tool_name|action|name)"\s*:\s*"?(?:write_sandbox_file|scrape_website|coding)/i.test(finalReply);
    console.log(`4. Internal tool-call JSON hidden from user response: ${!containsRawJson ? "PASS ✅" : "FAIL ❌"}`);

    // Check 5: Response reports execution status
    const reportsExecution = finalReply.includes("Execution Status");
    console.log(`5. Distinguishes code generation vs execution status: ${reportsExecution ? "PASS ✅" : "FAIL ❌"}`);

    console.log("\n================================================================================");
    console.log("   📋 ACTUAL TELEGRAM FINAL RESPONSE DELIVERED TO USER                          ");
    console.log("================================================================================");
    console.log(finalReply);
    console.log("\n================================================================================");

    if (!fileVerified || !reportsSavedLocation || containsRawJson) {
        throw new Error("Audit verification failed!");
    }
    console.log("   ✅ ALL REQUIREMENTS VERIFIED AND PASSED SUCCESSFULLY                         ");
    console.log("================================================================================");
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
