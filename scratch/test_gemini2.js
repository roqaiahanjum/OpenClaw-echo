const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const dotenv = require("dotenv");
dotenv.config();

const myTool = tool(async () => "foo", { name: "my_tool", description: "foo", schema: z.object({}) });

async function test() {
    try {
        const model = new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-2.5-flash",
        });
        const modelWithTools = model.bindTools([myTool]);
        const res = await modelWithTools.invoke("What is the time?");
        console.log("SUCCESS length:", res.content.length, "toolCalls:", res.tool_calls);
    } catch(e) {
        console.error("FAIL:", e.message);
    }
}
test();
