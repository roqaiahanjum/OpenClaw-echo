// @ts-nocheck
import { memory } from "../src/memory/manager";

async function runTest() {
    console.log("=== Testing Memory & Knowledge Graph Integration ===");

    const testChatId = "test_graph_chat_101";
    const userMsg = "My name is Roqaiah and I am building an autonomous project called OpenClaw Echo using TypeScript.";
    const agentRes = "That sounds amazing! OpenClaw Echo is a great project.";

    console.log("1. Saving interaction turn...");
    await memory.addInteraction(userMsg, agentRes, testChatId);

    console.log("2. Waiting 1.5 seconds for background GraphRAG extraction...");
    await new Promise(resolve => setTimeout(resolve, 1500));

    console.log("3. Fetching context payload via getContext()...");
    const context = await memory.getContext(userMsg, testChatId);

    console.log("\n--- CONTEXT OUTPUT ---");
    console.log(context);
    console.log("----------------------\n");

    const hasGraphHeader = context.includes("=== KNOWLEDGE GRAPH CONNECTIONS (GraphRAG) ===");
    const hasTriples = context.includes("DEVELOPING_PROJECT") || context.includes("IS_NAMED") || context.includes("User");

    if (hasGraphHeader && hasTriples) {
        console.log("✅ SUCCESS: GraphRAG relations successfully wired and retrieved in context!");
    } else {
        console.error("❌ FAILURE: GraphRAG relations missing from context payload.");
        process.exit(1);
    }

    process.exit(0);
}

runTest().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
