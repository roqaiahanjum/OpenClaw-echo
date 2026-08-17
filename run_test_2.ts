import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";
import { ModelRouter } from "./src/core/router";

dotenv.config();

async function runTest2() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("Simulating Quota Error to test Circuit Breaker & Fallback...");
    // Force a corrupted API key for Gemini to trigger fallback
    process.env.GOOGLE_API_KEY = "corrupted_api_key_test";
    
    // Also, we can trigger the circuit breaker manually or just see if the Router handles it properly.
    const router = ModelRouter.getInstance();
    
    const input = "Tell me a very short joke.";
    
    const replyFn = async (text: string) => {
        console.log(`\n[Bot Reply] => ${text}\n`);
    };

    const startTime = Date.now();
    try {
        await executeAutonomousFlow(input, "test_chat_2", false, replyFn);
        console.log(`Test execution completed in ${Date.now() - startTime}ms`);
    } catch (e: any) {
        console.error("Test execution failed:", e);
    }
}

runTest2().then(() => process.exit(0));
