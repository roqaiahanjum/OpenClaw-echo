import { MemoryManager } from "./src/memory/manager";
import * as dotenv from "dotenv";

dotenv.config();

async function runTest6() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    // Save a fact
    await MemoryManager.getInstance().saveFact("preference", "color", "cyan");
    
    // Get the initial timestamp
    const facts = await MemoryManager.getInstance().getAllFacts();
    const initialFact = facts.find(f => f.key === "color");
    console.log("Initial Timestamp:", initialFact?.timestamp);
    
    console.log("Waiting 2 seconds...");
    await new Promise(r => setTimeout(r, 2000));
    
    // Re-save the identical fact
    await MemoryManager.getInstance().saveFact("preference", "color", "cyan");
    
    // Get the new timestamp
    const updatedFacts = await MemoryManager.getInstance().getAllFacts();
    const updatedFact = updatedFacts.find(f => f.key === "color");
    console.log("Updated Timestamp:", updatedFact?.timestamp);
    
    if (initialFact?.timestamp !== updatedFact?.timestamp) {
        console.log("✅ Timestamp updated successfully for identical fact.");
    } else {
        console.error("❌ Timestamp did NOT update.");
    }
}

runTest6().then(() => process.exit(0));
