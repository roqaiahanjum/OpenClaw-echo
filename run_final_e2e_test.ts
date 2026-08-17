import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";
import * as fs from "fs/promises";
import * as path from "path";

dotenv.config();

async function runFinalE2ETest() {
    console.log("=== FINAL E2E AUTONOMOUS FALLBACK TEST ===");
    console.log("1. Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("2. Forcing Gemini failure by corrupting the API key...");
    process.env.GOOGLE_API_KEY = "corrupted_api_key_e2e_test";
    
    const input = "Create a file named fallback_e2e_test.txt containing 'OpenClaw fallback test successful', then read the file and return its exact contents.";
    
    let botResponse = "";
    const replyFn = async (text: string) => {
        botResponse = text;
        console.log(`\n[Bot Reply] => ${text}\n`);
    };

    console.log("3. Executing Autonomous Flow...");
    try {
        await executeAutonomousFlow(input, "test_chat_e2e_fallback", false, replyFn);
        console.log("4. E2E Flow Execution completed. Verifying results...\n");
        
        // Validation Checks
        let sandboxFileCreated = false;
        let sandboxFileContentMatches = false;
        let readOperationSuccess = false;
        let botResponseContainsMatch = false;

        const sandboxFilePath = path.resolve("src/sandbox/fallback_e2e_test.txt");
        try {
            const content = await fs.readFile(sandboxFilePath, "utf-8");
            sandboxFileCreated = true;
            if (content.trim() === "OpenClaw fallback test successful") {
                sandboxFileContentMatches = true;
            }
            console.log(`[Verification] File 'src/sandbox/fallback_e2e_test.txt' read. Content: "${content}"`);
        } catch (e: any) {
            console.log(`[Verification Fail] Sandbox file read error: ${e.message}`);
        }

        if (botResponse.includes("OpenClaw fallback test successful")) {
            botResponseContainsMatch = true;
        }

        console.log("\n=== VERIFICATION RESULTS ===");
        console.log(`- Filesystem creation verification: ${sandboxFileCreated && sandboxFileContentMatches ? "PASS" : "FAIL"}`);
        console.log(`- Telegram final response check: ${botResponseContainsMatch ? "PASS" : "FAIL"}`);
        
    } catch (e: any) {
        console.error("Test execution encountered an error:", e);
    }
}

runFinalE2ETest().then(() => process.exit(0));
