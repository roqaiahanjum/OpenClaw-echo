import { CodingSubAgent } from "../src/agents/workers/CodingSubAgent";
import { ACPTask } from "../src/agents/types";
import * as fs from "fs/promises";
import * as path from "path";
import { SANDBOX_DIR } from "../src/core/storage";

async function testASTSyntaxAndFileVerification() {
    console.log("=== REGRESSION TEST: Real AST Syntax & Sandbox File Verification ===");

    const codingAgent = new CodingSubAgent();

    // 1. Test Valid TypeScript Syntax & Real File Creation
    console.log("\n[Test 1] Testing Valid TypeScript generation and real disk write...");
    const validTask: ACPTask = {
        taskId: "test_ast_valid_1",
        parentId: "root",
        targetAgent: "coding",
        taskDescription: "Create a valid TypeScript math module named ast_valid_test.ts with interface MathOp { add(a: number, b: number): number; }",
        contextPayload: {
            fileName: "ast_valid_test.ts",
            skipGeneration: false
        },
        maxDepth: 1,
        dependsOn: []
    };

    const validResult = await codingAgent.execute(validTask);
    console.log(`Execution Status: ${validResult.status}`);
    console.log(`AST Validation Present: ${validResult.resultData.includes("AST Syntax Validation: PASSED")}`);
    console.log(`File Status Present: ${validResult.resultData.includes("VERIFIED ON DISK (via fs.stat) ✅")}`);

    if (validResult.status !== "SUCCESS") {
        throw new Error(`FAIL: Valid TypeScript generation failed: ${validResult.error}`);
    }
    if (!validResult.resultData.includes("AST Syntax Validation: PASSED")) {
        throw new Error("FAIL: AST Syntax Validation was not reported as passed!");
    }

    // Verify physical file on disk in SANDBOX_DIR
    const targetPath = path.resolve(SANDBOX_DIR, "ast_valid_test.ts");
    const stat = await fs.stat(targetPath);
    console.log(`Verified Physical File Size: ${stat.size} bytes at ${targetPath}`);
    if (stat.size === 0) throw new Error("FAIL: Physical file on disk is empty!");

    // 2. Test Invalid TypeScript Syntax detection via real AST parser
    console.log("\n[Test 2] Testing real AST parser rejection of broken syntax...");
    const brokenCode = `function brokenSyntax( { return ;`; // Syntax error: missing parameter list / closing paren
    const syntaxCheck = (codingAgent as any).validateSyntax(brokenCode, "broken.ts");
    console.log(`Broken syntax valid: ${syntaxCheck.valid}, error: "${syntaxCheck.error}"`);
    if (syntaxCheck.valid) {
        throw new Error("FAIL: Broken TypeScript was falsely validated as valid!");
    }

    console.log("\n✅ ALL AST SYNTAX & REAL FILE VERIFICATION TESTS PASSED.");
}

testASTSyntaxAndFileVerification().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
