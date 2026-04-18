const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const dotenv = require("dotenv");
dotenv.config();

async function test() {
    try {
        const model = new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-2.5-flash",
        });
        const msg = new HumanMessage({
            content: [
                { type: "text", text: "What is this image about?" },
                { type: "image_url", image_url: { url: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png" } }
            ]
        });
        const res = await model.invoke([msg]);
        console.log("SUCCESS length:", res.content.length);
    } catch(e) {
        console.error("FAIL:", e.message);
    }
}
test();
