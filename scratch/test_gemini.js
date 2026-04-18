const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const dotenv = require("dotenv");
dotenv.config();

async function test() {
    try {
        const model = new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-1.5-flash",
        });
        const res = await model.invoke("Hello");
        console.log("SUCCESS length:", res.content.length);
    } catch(e) {
        if(e.response) {
            console.error("FAIL default param response status:", e.response.status);
            console.error("FAIL message:", e.message);
        } else {
            console.error("FAIL default param:", e.message);
        }
    }
}
test();
