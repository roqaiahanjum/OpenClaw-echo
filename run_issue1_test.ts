import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";
import { ModelRouter } from "./src/core/router";

dotenv.config();

async function runIssue1Test() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("Simulating Gemini failure to force Groq fallback...");
    // Force corrupted API key for Gemini to trigger fallback instantly
    process.env.GOOGLE_API_KEY = "corrupted_api_key_test";
    
    const input = "Create a file named fallback_test.txt containing 'OpenClaw fallback test successful.' Then read the file and return its exact contents.";
    
    const replyFn = async (text: string) => {
        console.log(`\n[Bot Reply] => ${text}\n`);
    };

    console.log("Executing Autonomous Flow...");
    try {
        await executeAutonomousFlow(input, "test_chat_fallback", false, replyFn);
        console.log("Test execution completed.");
    } catch (e: any) {
        console.error("Test execution failed:", e);
    }
}

runIssue1Test().then(() => process.exit(0));
