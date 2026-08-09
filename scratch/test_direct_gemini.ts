import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function testDirect() {
    console.log("Testing @google/generative-ai direct SDK...");
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("Hello, answer in one word.");
        console.log("✅ Direct SDK Success:", result.response.text());
    } catch (e: any) {
        console.error("❌ Direct SDK Error:", e.message);
    }
}

testDirect();
