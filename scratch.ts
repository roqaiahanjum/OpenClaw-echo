import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";
dotenv.config();

async function test() {
  const chatModels = ["gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
  const embedModels = ["embedding-001", "text-embedding-004", "gemini-embedding-001"];

  console.log("--- TESTING CHAT MODELS ---");
  for (const m of chatModels) {
    try {
      const chat = new ChatGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, model: m });
      await chat.invoke("test");
      console.log(`✅ ${m} works!`);
    } catch (e) {
      console.log(`❌ ${m} fails: ${e.message}`);
    }
  }

  console.log("\n--- TESTING EMBEDDING MODELS ---");
  for (const m of embedModels) {
    try {
      const embed = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GOOGLE_API_KEY, model: m });
      await embed.embedQuery("test");
      console.log(`✅ ${m} works!`);
    } catch (e) {
      console.log(`❌ ${m} fails: ${e.message}`);
    }
  }
}

test();
