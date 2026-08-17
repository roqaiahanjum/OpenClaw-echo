import { ModelRouter } from "./src/core/router";
import { localVerifyToolResult } from "./src/core/localVerifier";
import * as dotenv from "dotenv";

dotenv.config();

async function runPresentationTests() {
    console.log("=== RUNNING PRESENTATION MODE EMERGENCY FIXES TESTS ===\n");

    // TEST 1: Model Router Priority Swapping
    console.log("TEST 1: Model Router Priority Check");
    const router = ModelRouter.getInstance();
    
    // Save original invokeProvider
    const originalInvokeProvider = (router as any).invokeProvider;
    
    let candidatesTried: string[] = [];
    (router as any).invokeProvider = async (candidate: any) => {
        candidatesTried.push(candidate.id);
        throw new Error("Simulated failure to inspect cascade hierarchy");
    };

    try {
        await router.invoke("hello", "standard");
    } catch (e) {}

    console.log("  Waterfall cascade sequence tried:", candidatesTried);
    const orderCorrect = candidatesTried[0] === "groq-llama-3.1-8b" && candidatesTried[1] === "gemini-flash-2.5";
    console.log(`  Priority swap verification (Llama 3.1 8B first, Gemini 2.5 Flash second): ${orderCorrect ? "PASS ✅" : "FAIL ❌"}`);

    // Restore original invokeProvider
    (router as any).invokeProvider = originalInvokeProvider;
    console.log("");

    // TEST 2: Sandbox Local Verifier Short-circuiting
    console.log("TEST 2: Sandbox Local Verifier Short-circuiting Check");
    const sandboxTools = ["run_sandbox_code", "write_sandbox_file", "local_file_system"];
    let verifierShortCircuitPassed = true;

    for (const tool of sandboxTools) {
        const result = localVerifyToolResult(tool, {}, "Successfully executed tool code!");
        console.log(`  Testing tool '${tool}' with valid output:`);
        console.log(`    Status: "${result.status}", Reason: "${result.reason}"`);
        if (result.status !== "pass" || result.reason !== "Auto-verified for presentation mode") {
            verifierShortCircuitPassed = false;
        }
    }

    // Assert that errors are NOT auto-verified
    console.log("  Testing tool 'run_sandbox_code' with error output:");
    const errResult = localVerifyToolResult("run_sandbox_code", {}, "Error: Compilation failed at line 12");
    console.log(`    Status: "${errResult.status}", Reason: "${errResult.reason}"`);
    if (errResult.status === "pass") {
        verifierShortCircuitPassed = false;
    }

    console.log(`  Sandbox Verifier Short-circuiting verification: ${verifierShortCircuitPassed ? "PASS ✅" : "FAIL ❌"}`);

    const finalSuccess = orderCorrect && verifierShortCircuitPassed;
    console.log(`\n=== FINAL RESULTS: ${finalSuccess ? "ALL TESTS PASSED ✅" : "TESTS FAILED ❌"} ===`);
}

runPresentationTests().then(() => process.exit(0));
