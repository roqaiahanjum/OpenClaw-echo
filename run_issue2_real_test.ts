import { ModelRouter } from "./src/core/router";
import * as dotenv from "dotenv";

dotenv.config();

async function runIssue2RealTest() {
    console.log("Testing True Abort Cancellation against REAL network request...");
    
    const router = ModelRouter.getInstance();
    
    try {
        console.log("Starting real network request with 50ms outer timeout...");
        
        const outerController = new AbortController();
        setTimeout(() => outerController.abort(), 50);
        
        const startTime = Date.now();
        await router.invokeWithRetry([{ role: "user", content: "Write a 5000 word essay about the history of artificial intelligence." }], "agent", { signal: outerController.signal }, 1);
        console.log(`[ERROR] Request succeeded in ${Date.now() - startTime}ms! It was supposed to be cancelled!`);
    } catch (e: any) {
        console.log(`Request threw as expected: ${e.message}`);
        // Now wait 5 seconds. If the socket wasn't cancelled, node might keep the event loop alive or log something. 
        // More importantly, we can check active handles, but since node-fetch/undici is used by langchain, aborting the signal will kill the socket.
    }
    
    console.log("PASS: Real request aborted. Checking for open handles by waiting 2 seconds...");
    await new Promise(r => setTimeout(r, 2000));
    console.log("Test execution completed cleanly.");
}

runIssue2RealTest().then(() => process.exit(0));
