import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function findQuotaModel() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
    const models = [
        "gemini-2.5-flash",
        "gemini-2.0-flash-lite",
        "gemini-flash-latest",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
    ];

    for (const m of models) {
        console.log(`Checking ${m}...`);
        try {
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent("Hello");
            console.log(`✅ WORKING MODEL: ${m}`);
            console.log("Response:", result.response.text());
            return m;
        } catch (e: any) {
            console.log(`❌ ${m} error: ${e.message.split('\n')[0]}`);
        }
    }
}

findQuotaModel();
