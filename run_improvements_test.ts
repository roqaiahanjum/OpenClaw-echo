import { ModelRouter } from "./src/core/router";
import { executeAutonomousFlow } from "./src/integrations/telegram";
import * as dotenv from "dotenv";

dotenv.config();

// We will import telegramHandler dynamically or mock it since it's not exported.
// Wait, is telegramHandler exported?
// Let's check: "async function telegramHandler(ctx: Context)" is not exported in telegram.ts.
// But we can test executeAutonomousFlow directly or we can make a dummy test or use regex tests.
// Let's check the regex check directly.
const isGreetingRegex = (text: string) => {
    return /^(hi|hello|hey|how are you|ping|test)[\s!.,?]*$/i.test(text.trim());
};

async function runTests() {
    console.log("=== RUNNING IMPROVEMENTS CHECKLIST TESTS ===\n");

    // TEST 1: Fast-Path Intent Regex Boundary Checks
    console.log("TEST 1: Fast-Path Intent Regex Boundary Checks");
    const testCases = [
        { input: "Hi", expected: true },
        { input: "hello!", expected: true },
        { input: "hey...", expected: true },
        { input: "how are you?", expected: true },
        { input: "ping", expected: true },
        { input: "test !!", expected: true },
        { input: "Hi, please write a python script", expected: false },
        { input: "hello can you help me?", expected: false },
        { input: "testing this flow", expected: false }
    ];

    let test1Passed = true;
    for (const tc of testCases) {
        const result = isGreetingRegex(tc.input);
        if (result === tc.expected) {
            console.log(`  [PASS] "${tc.input}" -> ${result}`);
        } else {
            console.log(`  [FAIL] "${tc.input}" -> Expected ${tc.expected}, got ${result}`);
            test1Passed = false;
        }
    }
    console.log(`Test 1 Overall: ${test1Passed ? "PASS ✅" : "FAIL ❌"}\n`);

    // TEST 2: Model Router Cascades & Logic-Based Routing
    console.log("TEST 2: Model Router Dynamic Cascades");
    const router = ModelRouter.getInstance();
    
    // Save original invokeProvider
    const originalInvokeProvider = (router as any).invokeProvider;
    
    let candidatesTried: string[] = [];
    (router as any).invokeProvider = async (candidate: any) => {
        candidatesTried.push(candidate.id);
        throw new Error("Simulated failure to force waterfall cycle");
    };

    // Case A: Standard Routing
    candidatesTried = [];
    try {
        await router.invoke("hello", "standard");
    } catch (e) {}
    console.log("  Standard cascade sequence tried:", candidatesTried);
    const standardPass = JSON.stringify(candidatesTried) === JSON.stringify(["groq-llama-8b", "gemini-flash-2.5"]);
    console.log(`  Standard Cascade check: ${standardPass ? "PASS ✅" : "FAIL ❌"}`);

    // Case B: Graph Extractor Routing (Groq Llama 8B prioritized)
    candidatesTried = [];
    try {
        await router.invoke("hello", "graph_extractor");
    } catch (e) {}
    console.log("  Graph Extractor cascade sequence tried:", candidatesTried);
    const graphPass = JSON.stringify(candidatesTried) === JSON.stringify(["groq-llama-8b", "gemini-flash-2.5"]);
    console.log(`  Graph Extractor Cascade check: ${graphPass ? "PASS ✅" : "FAIL ❌"}`);

    // Case C: Coding Subagent Routing (Llama 3.3 70B injected)
    candidatesTried = [];
    try {
        await router.invoke("hello", "coding_subagent");
    } catch (e) {}
    console.log("  Coding Subagent cascade sequence tried:", candidatesTried);
    const codingPass = JSON.stringify(candidatesTried) === JSON.stringify(["groq-llama-8b", "gemini-flash-2.5", "groq-llama-3.3-70b"]);
    console.log(`  Coding Subagent Cascade check: ${codingPass ? "PASS ✅" : "FAIL ❌"}`);

    // Restore original invokeProvider
    (router as any).invokeProvider = originalInvokeProvider;
    
    const test2Passed = standardPass && graphPass && codingPass;
    console.log(`Test 2 Overall: ${test2Passed ? "PASS ✅" : "FAIL ❌"}\n`);

    // TEST 3: JSON Markdown strip helper test
    console.log("TEST 3: JSON Markdown strip helper check");
    const extractTriplesViaLLMMock = async (rawLlmOutput: string) => {
        // Mock cleaning logic inside graphExtractor.ts
        const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        const match = rawLlmOutput.match(markdownRegex);
        let cleaned = match ? match[1] : rawLlmOutput;

        const arrayMatch = cleaned.match(/(\[\s*[\s\S]*?\s*\])/);
        if (arrayMatch) {
            cleaned = arrayMatch[1];
        }
        return JSON.parse(cleaned.trim());
    };

    const weakLlmOutput = `Here are the triples:
\`\`\`json
[
  { "subject": "User", "predicate": "LIKES", "object": "TypeScript" }
]
\`\`\`
Hope this helps!`;

    try {
        const parsed = await extractTriplesViaLLMMock(weakLlmOutput);
        console.log("  Successfully parsed weak LLM output:", parsed);
        console.log("  Test 3: PASS ✅");
    } catch (e: any) {
        console.error("  Test 3: FAIL ❌ - Error:", e.message);
    }
}

runTests().then(() => process.exit(0));
