import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
dotenv.config();

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
        // Query models via fetch directly or SDK
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`);
        const data = await res.json();
        console.log("AVAILABLE MODELS:");
        if (data.models) {
            data.models.forEach((m: any) => {
                if (m.supportedGenerationMethods?.includes("generateContent")) {
                    console.log(`- ${m.name}`);
                }
            });
        } else {
            console.log("Response:", JSON.stringify(data));
        }
    } catch (e: any) {
        console.error("Error listing models:", e.message);
    }
}

listModels();
