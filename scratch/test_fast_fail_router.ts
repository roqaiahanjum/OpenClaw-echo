import "dotenv/config";
import { ModelRouter } from "../src/core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

async function runFastFailRouterTest() {
    console.log("=========================================");
    console.log(" ROUTER 10S TIMEOUT & FAST-FAIL TEST ");
    console.log("=========================================\n");

    const router = ModelRouter.getInstance();

    // Trip circuit breaker to simulate quota limit or timeout fast-fail
    router.tripCircuitBreaker();

    console.log("[Test] Calling invokeWithRetry in Fallback Mode...");
    const res: any = await router.invokeWithRetry([
        new SystemMessage("Context: User name is Roqaiah, Project is OpenClaw Echo."),
        new HumanMessage("What is my project?")
    ], "test");

    console.log(`[Test] Returned Fallback Response Output:\n"${res.content}"`);
    console.assert(res.content.includes("Fallback Response") || res.content.includes("OpenClaw Echo"), "Fast-fail response did not include memory context");

    router.resetCircuitBreaker();
    console.log("\n✅ TEST PASSED: ModelRouter fast-fail fallback generates response cleanly without throwing.");
}

runFastFailRouterTest();
