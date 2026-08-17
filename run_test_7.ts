import { MemoryManager } from "./src/memory/manager";
import * as dotenv from "dotenv";

dotenv.config();

async function runTest5() {
    console.log("Initializing memory...");
    await MemoryManager.getInstance().initialize();
    
    console.log("1. Saving fact 'test_fact'");
    await MemoryManager.getInstance().saveFact("test", "test_fact", "value1");
    
    let facts = await MemoryManager.getInstance().getAllFacts();
    let fact = facts.find(f => f.key === "test_fact");
    console.log("2. Recorded timestamp:", fact?.timestamp);
    
    console.log("Waiting 2s...");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("3. Saving exact same fact again...");
    await MemoryManager.getInstance().saveFact("test", "test_fact", "value1");
    
    facts = await MemoryManager.getInstance().getAllFacts();
    let newFact = facts.find(f => f.key === "test_fact");
    console.log("4. New timestamp:", newFact?.timestamp);
    
    console.log("5. Adding 15 other facts to push it down...");
    for (let i = 0; i < 15; i++) {
        await MemoryManager.getInstance().saveFact("filler", `filler_${i}`, `filler_value_${i}`);
    }
    
    // Now simulate getSemanticContext
    console.log("6. Simulating getSemanticContext...");
    // getSemanticContext fetches all facts, slices top 10 (most recent).
    // If the timestamp updated, our "test_fact" should be at position ~15 because we just inserted 15 facts AFTER it.
    // Wait, if we inserted 15 facts AFTER it, they will have newer timestamps! 
    // To prove LRU prioritization, we should insert 15 facts, THEN reaffirm "test_fact", and check if it pops to the top!
    
    console.log("--- Let's do it the correct way to prove prioritization ---");
    console.log("Inserting 15 facts...");
    for (let i = 0; i < 15; i++) {
        await MemoryManager.getInstance().saveFact("filler2", `filler2_${i}`, `filler_value_${i}`);
    }
    
    let currentFacts = await MemoryManager.getInstance().getAllFacts();
    let indexBefore = currentFacts.findIndex(f => f.key === "test_fact");
    console.log(`Index of test_fact BEFORE reaffirming (should be > 10): ${indexBefore}`);
    
    console.log("Waiting 2s...");
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Reaffirming test_fact...");
    await MemoryManager.getInstance().saveFact("test", "test_fact", "value1");
    
    let finalFacts = await MemoryManager.getInstance().getAllFacts();
    let indexAfter = finalFacts.findIndex(f => f.key === "test_fact");
    console.log(`7. Index of test_fact AFTER reaffirming (should be 0, top priority): ${indexAfter}`);
}

runTest5().then(() => process.exit(0));
