import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";
import { MemoryManager } from "./src/memory/manager";

dotenv.config();

async function runTest4() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("Saving new semantic interactions to generate embeddings...");
    await MemoryManager.getInstance().addInteraction("What is the capital of France?", "The capital of France is Paris.", "test_chat");
    await MemoryManager.getInstance().addInteraction("Who is the CEO of OpenClaw?", "The CEO is an AI.", "test_chat");
    
    console.log("Testing memory retrieval...");
    // Let's retrieve context
    const context = await MemoryManager.getInstance().getSemanticContext("Who runs OpenClaw?", "test_chat");
    console.log("\n[Retrieved Context]\n" + context);
    
    console.log("\nTest execution completed.");
}

runTest4().then(() => process.exit(0));
