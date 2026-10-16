import { ModelRouter } from "../src/core/router";
import { HumanMessage } from "@langchain/core/messages";

async function testRouterDecommissionFailover() {
    console.log("=== REGRESSION TEST: Router Decommissioned Model Failover ===");

    const router = ModelRouter.getInstance();

    // Reset circuit breaker state before testing
    router.resetCircuitBreaker();

    // 1. Test that HTTP 400 with 'model_decommissioned' or 'model_not_found' trips circuit breaker
    console.log("\n[Test 1] Simulating provider HTTP 400 model_decommissioned error...");
    const fakeDecommissionedCandidate = {
        id: "test-decommissioned-model",
        name: "Test Decommissioned Model",
        provider: "groq" as const,
        modelName: "llama3-8b-8192"
    };

    // Inject simulated candidate into waterfall by overriding invokeProvider once
    const originalInvokeProvider = (router as any).invokeProvider.bind(router);

    let failoverOccurred = false;
    (router as any).invokeProvider = async (candidate: any, messages: any, options: any) => {
        if (candidate.id === "groq-fast") {
            const decommissionError: any = new Error("400 Bad Request: The model 'llama3-8b-8192' has been decommissioned and is no longer available.");
            decommissionError.status = 400;
            decommissionError.code = "model_decommissioned";
            throw decommissionError;
        }
        if (candidate.id === "gemini-flash" || candidate.provider === "gemini") {
            failoverOccurred = true;
            return { content: "gemini-failover-success" };
        }
        return originalInvokeProvider(candidate, messages, options);
    };

    try {
        const response = await router.invoke([new HumanMessage("Hello")], "test");
        console.log(`Router response content: "${response.content}"`);
        console.log(`Failover to Gemini occurred: ${failoverOccurred}`);
        console.log(`Primary candidate in cooldown: ${router.isModelInCooldown("groq-fast")}`);

        if (!failoverOccurred || response.content !== "gemini-failover-success") {
            throw new Error("FAIL: Router did not failover to secondary provider on HTTP 400 model_decommissioned!");
        }
        if (!router.isModelInCooldown("groq-fast")) {
            throw new Error("FAIL: Decommissioned candidate was not placed into circuit breaker cooldown!");
        }
    } finally {
        (router as any).invokeProvider = originalInvokeProvider;
        router.resetCircuitBreaker();
    }

    // 2. Test that unrelated HTTP 400 Bad Request (e.g. invalid json payload) is NOT masked
    console.log("\n[Test 2] Testing that generic HTTP 400 Bad Request is NOT masked as a model failure...");
    let caughtGeneric400 = false;
    (router as any).invokeProvider = async (candidate: any) => {
        const genericBadReq: any = new Error("400 Bad Request: Invalid JSON body format");
        genericBadReq.status = 400;
        throw genericBadReq;
    };

    try {
        await router.invoke([new HumanMessage("Hello")], "test");
    } catch (e: any) {
        caughtGeneric400 = true;
        console.log(`Generic 400 correctly surfaced in last error: "${e.message}"`);
    } finally {
        (router as any).invokeProvider = originalInvokeProvider;
        router.resetCircuitBreaker();
    }

    if (!caughtGeneric400) {
        throw new Error("FAIL: Generic 400 Bad Request was improperly masked!");
    }

    console.log("\n✅ ALL ROUTER DECOMMISSION & ERROR BOUNDARY TESTS PASSED.");
}

testRouterDecommissionFailover().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
