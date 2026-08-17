import * as dotenv from "dotenv";
dotenv.config();
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SkillRegistry } from "../src/skills/registry";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { HumanMessage } from "@langchain/core/messages";

async function main() {
    const rawTools = SkillRegistry.getTools();
    const formatted = rawTools.map(t => {
        const openAITool = convertToOpenAITool(t);
        const fn = openAITool.function;
        if (fn.parameters) {
            delete fn.parameters.$schema;
        }
        return fn; // Pass the inner function object directly to Gemini
    });

    console.log("Formatted tool 22 (index 22):", JSON.stringify(formatted[22], null, 2));

    const model = new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY,
        model: "gemini-2.5-flash",
        temperature: 0.7
    }).bindTools(formatted);

    console.log("Invoking Gemini...");
    try {
        const res = await model.invoke([new HumanMessage("Search memory for test_tool_verification")]);
        console.log("Success! Response:", JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error("Gemini invocation failed! Error:", e.message);
    }
}

main().catch(console.error);
