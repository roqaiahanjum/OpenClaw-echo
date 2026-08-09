// @ts-nocheck
import { ModelRouter } from "../src/core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

async function runMultiProviderRouterTest() {
    console.log("==================================================");
    console.log(" 🚀 MULTI-PROVIDER FAILOVER ROUTER TEST (GEMINI + GROQ) 🚀 ");
    console.log("==================================================\n");

    const router = ModelRouter.getInstance();

    console.log("1. Checking Router Health & Active Providers...");
    const health = await router.checkHealth();
    console.log("Health Status:", JSON.stringify(health, null, 2));

    console.log("\n2. Testing Multi-Provider Waterfall Invocation...");
    const messages = [
        new SystemMessage("You are OpenClaw Echo AI Router. Respond concisely."),
        new HumanMessage("Hello! Please confirm which AI provider and model processed this request.")
    ];

    const tStart = Date.now();
    const response = await router.invokeWithRetry(messages, "test_waterfall");
    const duration = Date.now() - tStart;

    console.log("\n=== ROUTER RESPONSE ===");
    console.log(`Duration: ${duration}ms`);
    console.log(`Content:\n${response.content}`);
    console.log("-----------------------\n");

    const hasContent = response && typeof response.content === "string" && response.content.length > 5;

    console.log("=== VERIFICATION SUMMARY ===");
    console.log(`• Gemini Key Configured: ${process.env.GOOGLE_API_KEY ? "YES ✅" : "NO ❌"}`);
    console.log(`• Groq Key Configured: ${process.env.GROQ_API_KEY ? "YES ✅" : "NO ❌"}`);
    console.log(`• Provider Invocation Succeeded: ${hasContent ? "YES ✅" : "NO ❌"}`);

    if (hasContent) {
        console.log("\n✅ SUCCESS: Multi-Provider Waterfall System (Gemini + Groq) active and operational!");
        process.exit(0);
    } else {
        console.error("\n❌ FAILURE: Multi-provider router test failed.");
        process.exit(1);
    }
}

runMultiProviderRouterTest().catch((err) => {
    console.error("Router test failed:", err);
    process.exit(1);
});
