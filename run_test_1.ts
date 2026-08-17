import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";

dotenv.config();

async function runTest() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("Running autonomous flow...");
    const input = "Create a file named test_scope.txt and then read it";
    
    // Using a dummy replyFn
    const replyFn = async (text: string) => {
        console.log(`\n[Bot Reply] => ${text}\n`);
    };

    try {
        await executeAutonomousFlow(input, "test_chat_1", false, replyFn);
        console.log("Test execution completed.");
    } catch (e: any) {
        console.error("Test execution failed:", e);
    }
}

runTest().then(() => process.exit(0));
