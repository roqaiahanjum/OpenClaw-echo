import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs/promises';
import { MemoryManager } from './src/memory/manager';
import { SkillRegistry } from './src/skills/registry';
import { SubAgentManager } from './src/agents/SubAgentManager';
import { writeSandboxFileTool, runSandboxCodeTool } from './src/skills/tools';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
process.env.ENABLE_SANDBOX_EXECUTION = "true";

async function runSecurityIsolationTests() {
    console.log("================================================================================");
    console.log("   🔒 OPENCLAW ECHO: TENANT ISOLATION & CODING CONTRACT REGRESSION SUITE        ");
    console.log("================================================================================");

    const memory = MemoryManager.getInstance();
    await memory.initialize();

    let passedCount = 0;
    let totalCount = 0;

    function assert(condition: boolean, testName: string, detail: string) {
        totalCount++;
        if (condition) {
            passedCount++;
            console.log(`✅ [PASS] ${testName}`);
        } else {
            console.error(`❌ [FAIL] ${testName}`);
            console.error(`   Details: ${detail}`);
        }
    }

    // -------------------------------------------------------------------------
    // TEST 1: Multi-Tenant Layer 1 (Interactions) & Layer 3 (Facts) Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Layer 1 (Interactions) & Layer 3 (Facts) Tenant Isolation ---");
    const tenantAlice = `tenant_alice_${Date.now()}`;
    const tenantBob = `tenant_bob_${Date.now()}`;

    // Alice saves confidential project data
    await memory.saveFact("project", "confidential_codename", "Project Titan Ultra", 1.0, tenantAlice);
    await memory.addInteraction("What is our project codename?", "Our codename is Project Titan Ultra", tenantAlice);

    // Bob queries his own facts and interactions
    const bobFacts = await memory.getAllFacts(tenantBob);
    const bobTurns = await memory.getRecentTurns(tenantBob);
    assert(
        !bobFacts.some(f => f.value.includes("Project Titan Ultra")) && bobTurns.length === 0,
        "Layer 1 & Layer 3 Strict Isolation",
        `Bob retrieved facts: ${JSON.stringify(bobFacts)}, turns: ${JSON.stringify(bobTurns)}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Tenant Layer 2 (Vector Store) Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Layer 2 (Vector Search) Tenant Isolation ---");
    // Alice and Bob submit identical semantic query: "What is my confidential project codename?"
    const aliceSemantic = await memory.getSemanticContext("confidential project codename", tenantAlice);
    const bobSemantic = await memory.getSemanticContext("confidential project codename", tenantBob);

    assert(
        aliceSemantic.includes("Project Titan Ultra") && !bobSemantic.includes("Project Titan Ultra"),
        "Layer 2 Semantic Vector Search Isolation",
        `Alice context: "${aliceSemantic.slice(0, 80)}..." | Bob context: "${bobSemantic.slice(0, 80)}..."`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Multi-Tenant Layer 4 (Conversation Summaries) Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Layer 4 (Conversation Summaries) Tenant Isolation ---");
    const aliceSummaries = await memory.getRelevantSummaries(tenantAlice);
    const bobSummaries = await memory.getRelevantSummaries(tenantBob);
    assert(
        Array.isArray(aliceSummaries) && Array.isArray(bobSummaries) && !bobSummaries.some(s => JSON.stringify(s).includes("Titan Ultra")),
        "Layer 4 Summaries Isolation",
        `Bob summaries leaked Alice data: ${JSON.stringify(bobSummaries)}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Full 4-Layer getContext Zero Cross-Tenant Leakage
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Full MemoryManager.getContext Zero-Leakage Verification ---");
    const aliceFullContext = await memory.getContext("What is my confidential project codename?", tenantAlice);
    const bobFullContext = await memory.getContext("What is my confidential project codename?", tenantBob);

    assert(
        aliceFullContext.includes("Project Titan Ultra") && !bobFullContext.includes("Project Titan Ultra"),
        "Full MemoryManager.getContext Zero Leakage",
        `Bob received context: "${bobFullContext.slice(0, 150)}"`
    );

    // -------------------------------------------------------------------------
    // TEST 5: P2 Vector Invalidation on Fact Update (Contradiction Consistency)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Vector Replacement / Invalidation on Fact Update ---");
    const tenantCharlie = `tenant_charlie_${Date.now()}`;
    await memory.saveFact("preference", "favorite_ide", "Vim", 1.0, tenantCharlie);
    const contextBefore = await memory.getContext("What is my favorite IDE?", tenantCharlie);

    // Update fact to VS Code
    await memory.saveFact("preference", "favorite_ide", "VS Code", 1.0, tenantCharlie);
    const contextAfter = await memory.getContext("What is my favorite IDE?", tenantCharlie);

    assert(
        contextBefore.includes("Vim") && contextAfter.includes("VS Code") && !contextAfter.includes("Vim"),
        "Stale Vector Invalidation on Fact Update",
        `Context after update still contains stale 'Vim': "${contextAfter.slice(0, 150)}"`
    );

    // -------------------------------------------------------------------------
    // TEST 6: P1 Coding Tool Schema Normalization (fileName vs filename)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Coding Tool Parameter Normalization (writeSandboxFileTool) ---");
    const testFileCamel = `contract_camel_${Date.now()}.ts`;
    const testFileLower = `contract_lower_${Date.now()}.ts`;

    const writeCamel = await writeSandboxFileTool.invoke({
        fileName: testFileCamel,
        content: "export const camel = true;"
    });

    const writeLower = await writeSandboxFileTool.invoke({
        filename: testFileLower,
        content: "export const lower = true;"
    });

    assert(
        writeCamel.includes("Successfully created") && writeLower.includes("Successfully created"),
        "writeSandboxFileTool accepts both fileName and filename",
        `Camel: ${writeCamel} | Lower: ${writeLower}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: P1 Coding Tool runSandboxCodeTool with Both Aliases
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: runSandboxCodeTool Accepts Both fileName and filename ---");
    const runCamel = await runSandboxCodeTool.invoke({ fileName: testFileCamel });
    const runLower = await runSandboxCodeTool.invoke({ filename: testFileLower });

    assert(
        !runCamel.includes("Execution failed") && !runLower.includes("Execution failed"),
        "runSandboxCodeTool executes via both fileName and filename",
        `runCamel: ${runCamel} | runLower: ${runLower}`
    );

    // -------------------------------------------------------------------------
    // TEST 8: CodingSubAgent End-to-End File Creation, Verification & Modification
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 8: CodingSubAgent E2E Creation & Verification ---");
    const codingWorker = SubAgentManager.getInstance().getWorker("coding");
    const e2eTask = {
        taskId: `coding_e2e_${Date.now()}`,
        parentId: "root",
        targetAgent: "coding" as const,
        taskDescription: "Write a typescript function to compute the gcd of two numbers and run it.",
        contextPayload: {}
    };

    const e2eResult = await codingWorker!.execute(e2eTask);
    assert(
        e2eResult.status === "SUCCESS" && e2eResult.resultData.includes("EXECUTED ✅"),
        "CodingSubAgent end-to-end sandbox creation and verified execution",
        `Status: ${e2eResult.status}, Result: ${e2eResult.resultData.slice(0, 150)}`
    );

    // Cleanup generated test files
    for (const f of [testFileCamel, testFileLower]) {
        await fs.unlink(path.resolve(process.cwd(), "src", "sandbox", f)).catch(() => {});
    }

    console.log("\n================================================================================");
    console.log(`   🏁 SECURITY REGRESSION RESULTS: ${passedCount}/${totalCount} TESTS PASSED`);
    console.log("================================================================================");

    if (passedCount !== totalCount) {
        process.exit(1);
    }
}

runSecurityIsolationTests().catch(err => {
    console.error("Security regression suite threw unhandled exception:", err);
    process.exit(1);
});

