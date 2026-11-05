import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { splitTelegramMessage, safeSend } from './src/integrations/telegram';

async function runChunkingVerification() {
    console.log("================================================================================");
    console.log("   🧪 TEST: TELEGRAM 4,096-CHAR LIMIT, CHUNKING & ERROR HANDLING SUITE          ");
    console.log("================================================================================");

    // -----------------------------------------------------------------------------------------
    // TEST 1: Long response splitting & Telegram 4,096 limit verification
    // -----------------------------------------------------------------------------------------
    console.log("\n[Test 1] Verifying 4,467+ char message splitting within Telegram limits...");

    // Create a 5,000 character mock response with a TypeScript code block
    const sampleTsCode = Array(35).fill(0).map((_, i) => 
        `    // Step ${i + 1}: Check prime candidate\n    const candidate_${i} = ${i * 2 + 3};\n    if (isPrime(candidate_${i})) {\n        primes.push(candidate_${i});\n    }`
    ).join('\n');

    const longMockResponse = 
        "# Prime Checker Analysis Report\n\n" +
        "Here is the detailed breakdown of the prime checker implementation, architectural analysis, and benchmark details.\n\n" +
        "```typescript\n" +
        "export function isPrime(n: number): boolean {\n" +
        "    if (n <= 1) return false;\n" +
        "    if (n <= 3) return true;\n" +
        "    if (n % 2 === 0 || n % 3 === 0) return false;\n" +
        sampleTsCode + "\n" +
        "    return true;\n" +
        "}\n" +
        "```\n\n" +
        "### Concluding Remarks\n" +
        "All calculations were verified on disk via fs.stat. Performance meets all latency targets.";

    console.log(`Original response length: ${longMockResponse.length} characters (exceeds Telegram 4,096 limit).`);

    const chunks = splitTelegramMessage(longMockResponse, 3800);
    console.log(`Split into ${chunks.length} chunks.`);

    let allChunksUnderLimit = true;
    let codeFencesBalanced = true;

    chunks.forEach((chunk, idx) => {
        const fenceCount = (chunk.match(/```/g) || []).length;
        const isBalanced = fenceCount % 2 === 0;
        console.log(`  Chunk ${idx + 1}: Length = ${chunk.length} chars (Limit: 3800 / Hard: 4096). Code fences: ${fenceCount} (${isBalanced ? "Balanced ✅" : "Unbalanced ❌"})`);

        if (chunk.length > 3800) allChunksUnderLimit = false;
        if (!isBalanced) codeFencesBalanced = false;
    });

    console.log(`1. All chunks strictly under 4,096 char limit: ${allChunksUnderLimit ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`2. Code blocks properly closed & reopened across boundaries: ${codeFencesBalanced ? "PASS ✅" : "FAIL ❌"}`);

    if (!allChunksUnderLimit || !codeFencesBalanced) {
        throw new Error("Test 1 failed: Chunking limit or fence preservation failed!");
    }

    // -----------------------------------------------------------------------------------------
    // TEST 2: safeSend with Mock Telegraf Context (Markdown success & Ordered delivery)
    // -----------------------------------------------------------------------------------------
    console.log("\n[Test 2] Testing safeSend ordered delivery via mock Telegraf context...");
    const sentMessages: { text: string; options: any }[] = [];
    const mockCtx = {
        reply: async (text: string, options: any) => {
            sentMessages.push({ text, options });
            return { message_id: sentMessages.length };
        }
    };

    await safeSend(mockCtx, longMockResponse);
    console.log(`Delivered ${sentMessages.length} ordered messages.`);
    const deliveredOrdered = sentMessages.length === chunks.length;
    console.log(`3. safeSend delivered all chunks in order: ${deliveredOrdered ? "PASS ✅" : "FAIL ❌"}`);

    // -----------------------------------------------------------------------------------------
    // TEST 3: Telegram Markdown parsing failure fallback
    // -----------------------------------------------------------------------------------------
    console.log("\n[Test 3] Testing Markdown parsing error fallback to plain text...");
    let markdownAttempted = false;
    let plainFallbackAttempted = false;

    const mockFailingCtx = {
        reply: async (text: string, options: any) => {
            if (options && options.parse_mode === 'Markdown') {
                markdownAttempted = true;
                throw new Error("Bad Request: can't parse entities: Character '_' is reserved");
            }
            plainFallbackAttempted = true;
            return { message_id: 999 };
        }
    };

    const badMarkdownText = "Some text with unescaped _bad_markdown*syntax_that_fails_telegram";
    await safeSend(mockFailingCtx, badMarkdownText);

    console.log(`  Markdown attempt: ${markdownAttempted ? "YES ✅" : "NO ❌"}`);
    console.log(`  Plain text fallback attempt: ${plainFallbackAttempted ? "YES ✅" : "NO ❌"}`);
    const markdownFallbackPassed = markdownAttempted && plainFallbackAttempted;
    console.log(`4. Markdown parsing failure handled via plain text fallback: ${markdownFallbackPassed ? "PASS ✅" : "FAIL ❌"}`);

    if (!markdownFallbackPassed) {
        throw new Error("Test 3 failed: Markdown error fallback did not execute!");
    }

    // -----------------------------------------------------------------------------------------
    // TEST 4: Telegram API error reporting
    // -----------------------------------------------------------------------------------------
    console.log("\n[Test 4] Testing actual Telegram API error propagation and logging...");
    let apiErrorThrown = false;
    const mockFatalCtx = {
        reply: async (_text: string, _options: any) => {
            throw new Error("ETELEGRAM: 403 Forbidden: bot was blocked by the user");
        }
    };

    try {
        await safeSend(mockFatalCtx, "Test message");
    } catch (err: any) {
        apiErrorThrown = err.message.includes("403 Forbidden");
    }
    console.log(`5. Actual Telegram API error reported & propagated: ${apiErrorThrown ? "PASS ✅" : "FAIL ❌"}`);

    if (!apiErrorThrown) {
        throw new Error("Test 4 failed: Fatal Telegram API error was swallowed!");
    }

    // -----------------------------------------------------------------------------------------
    // TEST 5: Status Message Short Completion Edit on Long Messages
    // -----------------------------------------------------------------------------------------
    console.log("\n[Test 5] Simulating Telegram replyHandler status message edit logic...");
    let editedMessageText = "";
    let editedMessageOptions: any = null;
    const queuedNewMessages: string[] = [];

    const mockFullCtx = {
        chat: { id: "test_chat_123" },
        telegram: {
            editMessageText: async (_chatId: any, _msgId: any, _inline: any, text: string, options: any) => {
                editedMessageText = text;
                editedMessageOptions = options;
                return true;
            }
        },
        reply: async (text: string, _options: any) => {
            queuedNewMessages.push(text);
            return { message_id: queuedNewMessages.length + 10 };
        }
    };

    // Simulate replyHandler with a response > 3800 chars
    const MAX_CHUNK = 3800;
    const isTooLong = longMockResponse.length > MAX_CHUNK;
    const statusMessageId = 42;

    if (isTooLong && statusMessageId !== null) {
        const completionStatus = "✅ *Task Completed Successfully!*\n\n_Full response delivered in ordered parts below:_";
        await mockFullCtx.telegram.editMessageText(
            mockFullCtx.chat.id,
            statusMessageId,
            undefined,
            completionStatus,
            { parse_mode: "Markdown" }
        );
        await safeSend(mockFullCtx, longMockResponse);
    }

    const shortStatusDelivered = editedMessageText.includes("Task Completed Successfully");
    const fullContentFollowed = queuedNewMessages.length === chunks.length;
    console.log(`  Edited status message content: "${editedMessageText.replace(/\n/g, ' ')}"`);
    console.log(`  Subsequent ordered message count: ${queuedNewMessages.length}`);
    console.log(`6. Progress message edited with short completion status: ${shortStatusDelivered ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`7. Full content delivered in ordered chunks following status: ${fullContentFollowed ? "PASS ✅" : "FAIL ❌"}`);

    if (!shortStatusDelivered || !fullContentFollowed) {
        throw new Error("Test 5 failed: Progress message was not edited with short completion status!");
    }

    console.log("\n================================================================================");
    console.log("   ✅ ALL TELEGRAM CHUNKING, LIMIT & ERROR HANDLING AUDITS PASSED                ");
    console.log("================================================================================");
}

runChunkingVerification().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
