import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";
import { ModelRouter } from "./src/core/router";

dotenv.config();

async function runTest3() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("Simulating Quota Error to test Circuit Breaker...");
    const router = ModelRouter.getInstance();
    
    // Monkey-patch invokeProvider to throw a 429 error
    (router as any).invokeProvider = async () => {
        const error: any = new Error("Quota exceeded");
        error.status = 429;
        throw error;
    };
    
    const input = "Tell me a joke.";
    
    const replyFn = async (text: string) => {
        console.log(`\n[Bot Reply] => ${text}\n`);
    };

    try {
        await executeAutonomousFlow(input, "test_chat_3", false, replyFn);
        console.log("Test execution completed.");
    } catch (e: any) {
        console.error("Test execution failed:", e);
    }
}

runTest3().then(() => process.exit(0));
