import { sanitizeSandboxCode, writeSandboxFileTool } from "./src/skills/tools";
import * as path from "path";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runTest() {
    console.log("=== RUNNING SANDBOX SANITIZER TESTS ===\n");

    // TEST 1: Sanitizer Unit Tests
    console.log("--- TEST 1: sanitizeSandboxCode Unit Tests ---");

    const input1 = `### Python Code
\`\`\`typescript
// Import the required module
import { execSync } from 'child_process';

function calculateFactorial(n: number): number {
    return n <= 1 ? 1 : n * calculateFactorial(n - 1);
}

console.log(calculateFactorial(5));
\`\`\`

### Alternative Code
\`\`\`typescript
console.log("Alternative solution");
\`\`\`
`;

    const cleaned1 = sanitizeSandboxCode(input1);
    console.log("Cleaned Output 1:\n" + cleaned1 + "\n");

    if (cleaned1.includes("### Python Code") || cleaned1.includes("```typescript") || cleaned1.includes("### Alternative")) {
        throw new Error("FAIL: Cleaned output 1 still contains markdown headers or fences!");
    }
    if (!cleaned1.includes("import { execSync }") || !cleaned1.includes("calculateFactorial(5)")) {
        throw new Error("FAIL: Cleaned output 1 missing actual code!");
    }
    console.log("Test 1 PASS ✅\n");

    // TEST 2: Conversational Prose Removal
    console.log("--- TEST 2: Conversational Prose Removal ---");
    const input2 = `Here is the requested solution for your problem:
\`\`\`js
const result = 42;
console.log("Result:", result);
\`\`\`
Hope this helps! Let me know if you need anything else.`;

    const cleaned2 = sanitizeSandboxCode(input2);
    console.log("Cleaned Output 2:\n" + cleaned2 + "\n");

    if (cleaned2.includes("Here is the requested solution") || cleaned2.includes("Hope this helps")) {
        throw new Error("FAIL: Cleaned output 2 contains conversational prose!");
    }
    if (cleaned2 !== `const result = 42;\nconsole.log("Result:", result);`) {
        throw new Error(`FAIL: Unexpected cleaned output 2: "${cleaned2}"`);
    }
    console.log("Test 2 PASS ✅\n");

    // TEST 3: No Code Fences (Markdown Headers & Backticks)
    console.log("--- TEST 3: Header & Backtick Stripping Without Fences ---");
    const input3 = `### Factorial Script
\`const val = 100;\`
console.log(val);`;

    const cleaned3 = sanitizeSandboxCode(input3);
    console.log("Cleaned Output 3:\n" + cleaned3 + "\n");

    if (cleaned3.includes("### Factorial Script")) {
        throw new Error("FAIL: Header not stripped from non-fenced content!");
    }
    console.log("Test 3 PASS ✅\n");

    // TEST 4: End-to-End Sandbox File Writing & Execution Verification
    console.log("--- TEST 4: write_sandbox_file Tool & ts-node Execution ---");
    const sampleDirtyLLMOutput = `### Generated Factorial Script
\`\`\`typescript
function factorial(n: number): number {
    return n <= 1 ? 1 : n * factorial(n - 1);
}
console.log("Factorial of 5 is:", factorial(5));
\`\`\`

Feel free to run this script!`;

    const testFileName = "test_sanitized_factorial.ts";
    const toolResult = await writeSandboxFileTool.invoke({
        fileName: testFileName,
        content: sampleDirtyLLMOutput
    });

    console.log(`Tool Result: "${toolResult}"`);

    const filePath = path.resolve("src/sandbox", testFileName);
    const fileOnDisk = await fs.readFile(filePath, "utf-8");

    console.log("File Content On Disk:\n" + fileOnDisk + "\n");

    if (fileOnDisk.includes("### Generated Factorial Script") || fileOnDisk.includes("```typescript") || fileOnDisk.includes("Feel free to run this script")) {
        throw new Error("FAIL: File on disk still contains markdown formatting or prose!");
    }

    // Attempt compilation and execution with ts-node
    console.log(`Executing 'npx ts-node src/sandbox/${testFileName}'...`);
    const { stdout, stderr } = await execAsync(`npx ts-node "src/sandbox/${testFileName}"`);
    console.log(`Execution stdout: "${stdout.trim()}"`);

    if (!stdout.includes("Factorial of 5 is: 120")) {
        throw new Error(`FAIL: Unexpected script execution output: "${stdout}"`);
    }

    // Cleanup test file
    await fs.unlink(filePath).catch(() => {});

    console.log("Test 4 PASS ✅\n");

    console.log("=== ALL SANDBOX SANITIZER TESTS PASSED SUCCESSFULLY! ===");
    process.exit(0);
}

runTest().catch((err) => {
    console.error("Test suite failed:", err);
    process.exit(1);
});
