import "dotenv/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

async function testModels() {
    const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-flash-latest"];
    for (const m of models) {
        console.log(`Testing model: ${m}...`);
        try {
            const chat = new ChatGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_API_KEY,
                model: m,
                temperature: 0.7
            });
            const res = await Promise.race([
                chat.invoke("Hello, answer in one word."),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout 10s")), 10000))
            ]);
            console.log(`✅ SUCCESS [${m}]:`, (res as any).content);
            break;
        } catch (e: any) {
            console.error(`❌ FAIL [${m}]:`, e.message);
        }
    }
}

testModels();
