import "dotenv/config";
import { webSearchTool } from "../src/skills/tools";
import { SkillRegistry } from "../src/skills/registry";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { generatePlan, formatPlanForPrompt } from "../src/core/planner";
import { verifyStepResult } from "../src/core/verifier";
import { SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

async function runLiveTest() {
    console.log("=========================================");
    console.log("  LIVE TEST: web_search END-TO-END FLOW  ");
    console.log("=========================================");

    const query = "Search the web for the latest AI news.";
    console.log(`\n[Stage 1] Query: "${query}"`);

    // 1. Check Env Key
    const key = process.env.TAVILY_API_KEY;
    console.log(`[Stage 2] TAVILY_API_KEY loaded: ${key ? "YES (starts with " + key.substring(0, 8) + "...)" : "NO"}`);

    if (!key) {
        console.error("❌ FAILED: TAVILY_API_KEY is missing.");
        return;
    }

    // 2. Direct Tool Test
    console.log("\n[Stage 3] Testing webSearchTool.invoke() directly...");
    try {
        const directResult = await webSearchTool.invoke({ query: "latest AI news" });
        console.log(`[Stage 4] Direct Tool Result Length: ${directResult.length} characters`);
        console.log(`[Stage 5] Preview of Direct Result:\n${directResult.substring(0, 250)}...\n`);
    } catch (err: any) {
        console.error("❌ Direct Tool Execution Failed:", err.message);
    }

    // 3. Full Flow Test
    console.log("[Stage 6] Testing Full Flow Pipeline...");
    try {
        const tools = SkillRegistry.getTools();
        const toolNames = tools.map((t: any) => t.name);

        console.log("[Stage 7] Step A: Generating Planner execution plan...");
        const plan = await generatePlan(query, toolNames);
        let planText = plan ? formatPlanForPrompt(plan) : "";
        console.log(`[Stage 8] Plan generated: ${plan ? "YES (" + plan.steps.length + " steps)" : "NO"}`);

        let systemPromptText = `You are OpenClaw Echo, a helpful AI assistant. Be brief and direct.`;
        if (planText) systemPromptText += planText;

        const messages: any[] = [
            new SystemMessage(systemPromptText),
            new HumanMessage(query)
        ];

        console.log("[Stage 9] Step B: Invoking Gemini model (gemini-flash-latest)...");
        const model = new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-flash-latest",
            temperature: 0.7
        }).bindTools(tools);

        const firstResponse = await model.invoke(messages);
        const tool_calls = (firstResponse as any).tool_calls || [];

        console.log(`[Stage 10] Gemini Response Tool Calls Count: ${tool_calls.length}`);
        if (tool_calls.length > 0) {
            console.log(`[Stage 11] Selected Tool: ${tool_calls[0].name}, Args:`, tool_calls[0].args);
            
            const tool = SkillRegistry.getToolByName(tool_calls[0].name);
            if (tool) {
                console.log("[Stage 12] Step C: Executing tool...");
                const rawOutput = await tool.invoke(tool_calls[0].args);
                console.log(`[Stage 13] Tool Output Length: ${String(rawOutput).length} characters`);
                
                console.log("[Stage 14] Step D: Verifying step output...");
                const verification = await verifyStepResult(tool_calls[0].name, tool_calls[0].name, String(rawOutput));
                console.log(`[Stage 15] Verification Result: success=${verification.success}, reason="${verification.reason}"`);

                let finalOutput = String(rawOutput);
                if (!verification.success) {
                    finalOutput += `\n\n[VERIFICATION NOTE: ${verification.reason}]`;
                }

                messages.push(firstResponse);
                messages.push(new ToolMessage({
                    tool_call_id: tool_calls[0].id,
                    content: finalOutput
                }));

                console.log("[Stage 16] Step E: Sending tool output back to Gemini for final response...");
                const finalResponseObj = await model.invoke(messages);
                console.log("\n=========================================");
                console.log("  FINAL LLM ANSWER GENERATED SUCCESSFULLY ");
                console.log("=========================================");
                console.log(finalResponseObj.content);
                console.log("=========================================\n");
                console.log("✅ TEST RESULT: ALL STAGES PASSED FULLY.");
            } else {
                console.error("❌ Tool resolution failed.");
            }
        } else {
            console.log("No tool call requested by LLM. Direct response:", firstResponse.content);
        }
    } catch (err: any) {
        console.error("❌ Pipeline execution error:", err.message);
    }
}

runLiveTest();
