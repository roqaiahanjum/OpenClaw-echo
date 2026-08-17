import { MemoryManager } from "../src/memory/manager";
import * as dotenv from "dotenv";

dotenv.config();

async function saveSummary() {
    console.log("Initializing MemoryManager...");
    const memory = MemoryManager.getInstance();
    await memory.initialize();

    console.log("Saving deployment fact...");
    await memory.saveFact("deployment", "matrix_status", "OpenClaw Echo System v3.0 Online successfully executed and verified on 2026-08-16");

    console.log("Saving deployment interaction...");
    await memory.addInteraction(
        "List files, create matrix.js, and execute it",
        "OpenClaw Echo System v3.0 Online output verified. Saved deployment task summary to memory."
    );

    console.log("Deployment summary successfully persisted to memory!");
}

saveSummary().then(() => process.exit(0)).catch(e => {
    console.error("Failed to save deployment summary:", e);
    process.exit(1);
});
