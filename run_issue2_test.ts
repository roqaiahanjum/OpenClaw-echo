import { ModelRouter } from "./src/core/router";
import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";

dotenv.config();

async function runIssue2Test() {
    console.log("Testing True Abort Cancellation behavior...");
    
    let underlyingTaskFinished = false;
    let signalReceived = false;
    
    const router = ModelRouter.getInstance();
    
    // Monkey-patch invokeProvider to verify signal propagation
    (router as any).invokeProvider = async (candidate: any, messages: any, options: any) => {
        return new Promise((resolve, reject) => {
            if (options?.signal) {
                options.signal.addEventListener("abort", () => {
                    signalReceived = true;
                    console.log("[SUCCESS] AbortSignal triggered inside invokeProvider!");
                    reject(new Error("AbortError"));
                });
            }
            
            setTimeout(() => {
                underlyingTaskFinished = true;
                console.log("\n[DANGER] Underlying request finished in the background! (Resource leak)\n");
                resolve({ content: "Slow response", tool_calls: [] });
            }, 3000);
        });
    };
    
    try {
        console.log("Starting autonomous flow with slow provider (timeout expected in 55s, but we will patch the timeout to 1s for testing)...");
        
        // Wait, executeAutonomousFlow hardcodes 55s. Let's just call invokeWithRetry directly with a 1s outer AbortController to simulate the global timeout.
        const outerController = new AbortController();
        setTimeout(() => outerController.abort(), 1000);
        
        await router.invokeWithRetry([{ role: "user", content: "test" }], "agent", { signal: outerController.signal }, 1);
    } catch (e: any) {
        console.log(`Request threw: ${e.message}`);
    }
    
    console.log("Waiting 3 seconds to ensure background task is dead...");
    await new Promise(r => setTimeout(r, 3000));
    
    if (underlyingTaskFinished) {
        console.log("FAIL: The underlying task was NOT cancelled and finished in the background.");
    } else if (signalReceived) {
        console.log("PASS: The underlying task was successfully aborted via AbortSignal.");
    } else {
        console.log("FAIL: Abort signal was not received.");
    }
}

runIssue2Test().then(() => process.exit(0));
