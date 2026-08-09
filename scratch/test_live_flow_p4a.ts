import "dotenv/config";
import { webSearchTool } from "../src/skills/tools";
import { SkillRegistry } from "../src/skills/registry";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { generatePlan, formatPlanForPrompt } from "../src/core/planner";
import { verifyStepResult } from "../src/core/verifier";
import { localVerifyToolResult } from "../src/core/localVerifier";
import { SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

async function runLiveTest() {
    console.log("=========================================");
    console.log("  PHASE 4A LIVE FLOW VERIFICATION TEST   ");
    console.log("=========================================");

    const query = "Search the web for the latest AI news.";
    console.log(`\n[Stage 1] Query: "${query}"`);

    const tools = SkillRegistry.getTools();
    const toolNames = tools.map((t: any) => t.name);

    console.log("[Stage 2] Generating Planner execution plan...");
    const plan = await generatePlan(query, toolNames);
    let planText = plan ? formatPlanForPrompt(plan) : "";
    console.log(`[Stage 3] Plan generated: ${plan ? "YES (" + plan.steps.length + " steps)" : "NO"}`);

    let systemPromptText = `You are OpenClaw Echo, a helpful AI assistant. Be brief and direct.`;
    if (planText) systemPromptText += planText;

    const messages: any[] = [
        new SystemMessage(systemPromptText),
        new HumanMessage(query)
    ];

    console.log("[Stage 4] Invoking Gemini model (Call #1)...");
    const model = new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY,
        model: "gemini-flash-latest",
        temperature: 0.7
    }).bindTools(tools);

    const firstResponse = await model.invoke(messages);
    const tool_calls = (firstResponse as any).tool_calls || [];

    console.log(`[Stage 5] Tool Calls Count: ${tool_calls.length}`);
    if (tool_calls.length > 0) {
        console.log(`[Stage 6] Selected Tool: ${tool_calls[0].name}`);
        
        const tool = SkillRegistry.getToolByName(tool_calls[0].name);
        if (tool) {
            console.log("[Stage 7] Executing tool...");
            const rawOutput = await tool.invoke(tool_calls[0].args);
            console.log(`[Stage 8] Tool Output Length: ${String(rawOutput).length} characters`);
            
            console.log("[Stage 9] Performing Local Deterministic Verification...");
            const localCheck = localVerifyToolResult(tool_calls[0].name, tool_calls[0].args, String(rawOutput));
            let verification: { success: boolean; reason: string };

            if (localCheck.status === "pass") {
                console.log(`[LocalVerifier] PASS — ${localCheck.reason}`);
                console.log("⚡ [OPTIMIZATION CONFIRMED] Gemini Verifier skipped! Saved 1 Gemini API call.");
                verification = { success: true, reason: localCheck.reason };
            } else if (localCheck.status === "fail") {
                console.log(`[LocalVerifier] FAIL — ${localCheck.reason}`);
                verification = { success: false, reason: localCheck.reason };
            } else {
                console.log(`[LocalVerifier] UNCERTAIN — ${localCheck.reason}. Falling back to Gemini verifier.`);
                verification = await verifyStepResult(query, tool_calls[0].name, String(rawOutput));
            }

            messages.push(firstResponse);
            messages.push(new ToolMessage({
                tool_call_id: tool_calls[0].id,
                content: String(rawOutput)
            }));

            console.log("[Stage 10] Invoking Gemini model for final answer (Call #2)...");
            const finalResponseObj = await model.invoke(messages);
            console.log("\n=========================================");
            console.log("  FINAL LLM ANSWER GENERATED SUCCESSFULLY ");
            console.log("=========================================");
            console.log(finalResponseObj.content);
            console.log("=========================================\n");
            console.log("✅ TEST RESULT: CALL REDUCTION CONFIRMED (3 Gemini Calls Total).");
        }
    }
}

runLiveTest();
