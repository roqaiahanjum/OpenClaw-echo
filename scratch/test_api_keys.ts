import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import Groq from "groq-sdk";
import * as dotenv from "dotenv";

dotenv.config();

async function testGroq() {
    console.log("--- TESTING GROQ API KEY ---");
    const apiKey = process.env.GROQ_API_KEY;
    console.log(`Key prefix: ${apiKey ? apiKey.substring(0, 10) + "..." : "undefined"}`);
    
    if (!apiKey) {
        console.log("GROQ_API_KEY is not defined");
        return;
    }

    try {
        const groq = new Groq({ apiKey });
        const res = await groq.chat.completions.create({
            messages: [{ role: "user", content: "Say hello" }],
            model: "llama-3.1-8b-instant"
        });
        console.log("Groq Response:", res.choices[0]?.message?.content);
    } catch (e: any) {
        console.error("Groq failed:", e.message || e);
    }
}

async function testGemini() {
    console.log("\n--- TESTING GEMINI API KEY ---");
    const apiKey = process.env.GOOGLE_API_KEY;
    console.log(`Key prefix: ${apiKey ? apiKey.substring(0, 10) + "..." : "undefined"}`);
    
    if (!apiKey) {
        console.log("GOOGLE_API_KEY is not defined");
        return;
    }

    try {
        const model = new ChatGoogleGenerativeAI({
            apiKey: apiKey,
            model: "gemini-2.5-flash"
        });
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const res = await model.invoke("Say hello", { signal: controller.signal });
        clearTimeout(timeout);
        console.log("Gemini Response:", res.content);
    } catch (e: any) {
        console.error("Gemini failed:", e.message || e);
    }
}

async function run() {
    await testGroq();
    await testGemini();
}

run().then(() => process.exit(0));
