import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { executeAutonomousFlow, cleanUserFacingResponse } from './src/integrations/telegram';

async function testTelegramFlow() {
    console.log("================================================================================");
    console.log("   🧪 DEBUG TEST: TELEGRAM MULTI-AGENT EXECUTION PATH VERIFICATION             ");
    console.log("================================================================================");

    const testPrompt = "Research the benefits of TypeScript for AI agents, browse its official documentation, generate a TypeScript example, save the file, and give me a combined report.";
    console.log(`[Telegram Simulation] Incoming User Message:\n"${testPrompt}"\n`);

    let finalReplyDelivered = "";
    const mockReplyFn = async (replyText: string) => {
        finalReplyDelivered = replyText;
        console.log(`[MockTelegram] >>> Received Final Bot Reply (${replyText.length} chars) <<<`);
    };

    const mockProgressFn = async (progressText: string) => {
        console.log(`[MockTelegram Progress Edit] ${progressText}`);
    };

    const requestId = `test_tg_${Date.now()}`;
    const abortController = new AbortController();

    const startTime = Date.now();
    await executeAutonomousFlow(
        testPrompt,
        "123456789", // Mock chatId
        false,        // isPhoto
        mockReplyFn,
        undefined,    // photoLink
        false,        // isRetry
        abortController.signal,
        requestId,
        mockProgressFn
    );
    const duration = Date.now() - startTime;

    console.log(`\nFlow finished in ${duration}ms\n`);

    console.log("================================================================================");
    console.log("   🔍 VERIFICATION AUDIT CHECKS                                                 ");
    console.log("================================================================================");

    // Check 1: No raw tool call JSON in response
    const containsRawToolJson = /\{\s*"(?:tool|tool_name|action|name)"\s*:\s*"?(?:scrape_website|browser|coding|research|write_sandbox_file|web_search)/i.test(finalReplyDelivered);
    console.log(`1. Raw internal tool-call JSON hidden: ${!containsRawToolJson ? "PASS ✅" : "FAIL ❌ (Found raw tool JSON!)"}`);

    // Check 2: Browser returns observed content and source URL
    const containsBrowserUrl = finalReplyDelivered.includes("https://www.typescriptlang.org/docs/");
    const containsObservedContent = finalReplyDelivered.includes("Observed Page Content") || finalReplyDelivered.includes("Official Documentation Insights");
    console.log(`2. Browser returns source URL and observed content: ${(containsBrowserUrl && containsObservedContent) ? "PASS ✅" : "FAIL ❌"}`);

    // Check 3: Real file saved in sandbox and verified with fs.stat
    const expectedFilePath = path.resolve(process.cwd(), "src", "sandbox", "typescript_ai_agent_example.ts");
    let fileVerified = false;
    let fileSize = 0;
    try {
        const stat = await fs.stat(expectedFilePath);
        fileVerified = stat.isFile() && stat.size > 0;
        fileSize = stat.size;
    } catch {
        fileVerified = false;
    }
    console.log(`3. Sandbox file exists on disk via fs.stat: ${fileVerified ? `PASS ✅ (${fileSize} bytes)` : "FAIL ❌"}`);

    // Check 4: Final response reports actual saved location
    const reportsSavedLocation = finalReplyDelivered.includes("src/sandbox/typescript_ai_agent_example.ts") && finalReplyDelivered.includes("VERIFIED ON DISK");
    console.log(`4. Response reports actual saved file location: ${reportsSavedLocation ? "PASS ✅" : "FAIL ❌"}`);

    // Check 5: Response reports execution status
    const reportsExecutionStatus = finalReplyDelivered.includes("Execution Status");
    console.log(`5. Response reports real execution status: ${reportsExecutionStatus ? "PASS ✅" : "FAIL ❌"}`);

    console.log("\n================================================================================");
    console.log("   📋 ACTUAL TELEGRAM FINAL RESPONSE DELIVERED TO USER                          ");
    console.log("================================================================================");
    console.log(finalReplyDelivered);
    console.log("\n================================================================================");

    if (containsRawToolJson || !fileVerified || !reportsSavedLocation) {
        throw new Error("Verification checks failed!");
    }
    console.log("   ✅ ALL DEBUG VERIFICATION REQUIREMENTS PASSED                                ");
    console.log("================================================================================");
}

testTelegramFlow().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
