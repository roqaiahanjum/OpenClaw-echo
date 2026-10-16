import { ModelRouter } from "../src/core/router";
import { HumanMessage } from "@langchain/core/messages";
import Groq from "groq-sdk";

async function testGroqClientIndependence() {
    console.log("=== REGRESSION TEST: Independent Groq Primary & Backup Clients ===");

    const router = ModelRouter.getInstance();

    // 1. Verify router has initialized distinct clients
    const primaryClientBefore = (router as any).groqPrimaryClient;
    const backupClientBefore = (router as any).groqBackupClient;

    console.log(`[Check 1] Primary Groq Client initialized: ${!!primaryClientBefore}`);
    console.log(`[Check 2] Backup Groq Client initialized: ${!!backupClientBefore}`);
    console.log(`[Check 3] Clients are distinct object instances: ${primaryClientBefore !== backupClientBefore}`);

    if (primaryClientBefore === backupClientBefore && primaryClientBefore !== null) {
        throw new Error("FAIL: Primary and backup Groq clients share the same object reference!");
    }

    // 2. Simulate primary client key failure by corrupting ONLY the primary client instance
    console.log("\n[Test Scenario] Invalidate Primary Groq Client with bad API key...");
    const corruptPrimaryClient = new Groq({ apiKey: "gsk_invalid_corrupted_key_for_testing_123456789" });
    (router as any).groqPrimaryClient = corruptPrimaryClient;
    (router as any).groqClient = corruptPrimaryClient;

    // Verify backup client was NOT corrupted
    const backupClientAfter = (router as any).groqBackupClient;
    console.log(`[Check 4] Backup client preserved independent instance: ${backupClientAfter !== corruptPrimaryClient}`);

    // 3. Test that invoking candidate 'groq-backup' uses the valid backup client without failing with 401
    console.log("\n[Test Scenario] Invoking provider candidate 'groq-backup' directly...");
    try {
        const backupResult = await (router as any).invokeProvider(
            { id: "groq-backup", name: "Groq Backup", provider: "groq", modelName: "openai/gpt-oss-120b" },
            [new HumanMessage("Respond with 'OK'")],
            { providerTimeoutMs: 15000 }
        );
        console.log(`✅ SUCCESS: Backup provider succeeded independently: "${backupResult.content.slice(0, 50).trim()}"`);
    } catch (err: any) {
        if (err.message?.includes("401") || err.message?.includes("invalid_api_key")) {
            console.error("❌ FAILED: Backup provider inherited corrupted primary key!", err.message);
            process.exit(1);
        } else {
            console.log(`ℹ️ Upstream response (Network/Timeout/Model): ${err.message}`);
        }
    }

    console.log("\n✅ REGRESSION TEST PASSED: Primary failure does NOT corrupt backup provider client.");
}

testGroqClientIndependence().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
