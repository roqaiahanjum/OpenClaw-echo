import { ModelRouter, ProviderCandidate } from "./src/core/router";
import { AIMessage } from "@langchain/core/messages";

async function runTest() {
    console.log("=== RUNNING CIRCUIT BREAKER REFACTOR TEST ===\n");

    const router = ModelRouter.getInstance();

    // Reset circuit breaker state to clean start
    router.resetCircuitBreaker();

    // We will stub invokeProvider to control the outputs
    let invokeCounts: Record<string, number> = {
        "groq-llama-8b": 0,
        "gemini-flash-2.5": 0
    };

    // Keep the original invokeProvider so we can restore it later if needed
    const originalInvokeProvider = (router as any).invokeProvider;

    (router as any).invokeProvider = async (candidate: ProviderCandidate, messages: any, options: any) => {
        invokeCounts[candidate.id]++;
        
        if (candidate.id === "groq-llama-8b") {
            // Simulate a 429 rate limit
            const error = new Error("Quota exceeded: 429 Too Many Requests");
            (error as any).status = 429;
            throw error;
        }

        if (candidate.id === "gemini-flash-2.5") {
            // Return successful mock response
            return new AIMessage({
                content: "Hello from Gemini Fallback!",
                tool_calls: []
            });
        }

        throw new Error("Unexpected candidate: " + candidate.id);
    };

    console.log("--- TEST 1: Initial Waterfall Invocation (Primary fails with 429) ---");
    console.log("Expecting primary (groq) to fail with 429 and fallback to secondary (gemini)...");

    try {
        const response = await router.invoke("Test message");
        console.log(`Result content: "${response.content}"`);
        console.log("Invoke counts:", invokeCounts);

        // Verification 1:
        if (invokeCounts["groq-llama-8b"] !== 1) {
            throw new Error(`Expected groq to be invoked once, got ${invokeCounts["groq-llama-8b"]}`);
        }
        if (invokeCounts["gemini-flash-2.5"] !== 1) {
            throw new Error(`Expected gemini to be invoked once, got ${invokeCounts["gemini-flash-2.5"]}`);
        }
        if (response.content !== "Hello from Gemini Fallback!") {
            throw new Error("Expected fallback response content did not match");
        }

        // Verification 2: Check if primary model entered cooldown
        const isGroqInCooldown = router.isModelInCooldown("groq-llama-8b");
        console.log(`Is groq in cooldown? ${isGroqInCooldown}`);
        if (!isGroqInCooldown) {
            throw new Error("Expected groq to be in cooldown after 429 error");
        }

        console.log("Test 1 PASS ✅");
    } catch (e: any) {
        console.error("Test 1 FAIL ❌:", e.message);
        process.exit(1);
    }

    console.log("\n--- TEST 2: Subsequent Invocation (Primary in cooldown should be bypassed) ---");
    console.log("Expecting groq to be skipped entirely, and only gemini to be invoked...");

    // Reset invoke counts
    invokeCounts["groq-llama-8b"] = 0;
    invokeCounts["gemini-flash-2.5"] = 0;

    try {
        const response = await router.invoke("Test message 2");
        console.log(`Result content: "${response.content}"`);
        console.log("Invoke counts:", invokeCounts);

        // Verification 3:
        if (invokeCounts["groq-llama-8b"] !== 0) {
            throw new Error(`Expected groq to be bypassed (0 calls), but got ${invokeCounts["groq-llama-8b"]}`);
        }
        if (invokeCounts["gemini-flash-2.5"] !== 1) {
            throw new Error(`Expected gemini to be called once, got ${invokeCounts["gemini-flash-2.5"]}`);
        }
        if (response.content !== "Hello from Gemini Fallback!") {
            throw new Error("Expected fallback response content did not match");
        }

        console.log("Test 2 PASS ✅");
    } catch (e: any) {
        console.error("Test 2 FAIL ❌:", e.message);
        process.exit(1);
    }

    // Restore original method
    (router as any).invokeProvider = originalInvokeProvider;
    router.resetCircuitBreaker();

    console.log("\n=== ALL CIRCUIT BREAKER REFACTOR TESTS PASSED! ===");
    process.exit(0);
}

runTest();
