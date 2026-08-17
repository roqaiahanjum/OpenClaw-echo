import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";

dotenv.config();

async function testEmbedding() {
    try {
        const embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_API_KEY!,
            modelName: "text-embedding-004", // The generally supported name in Langchain
        });
        
        console.log("Testing text-embedding-004...");
        const res1 = await embeddings.embedQuery("Hello world");
        console.log(`text-embedding-004 dimensions: ${res1.length}`);
    } catch (e: any) {
        console.error("text-embedding-004 failed:", e.message);
    }
    
    try {
        const embeddings2 = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_API_KEY!,
            modelName: "text-embedding-004", // Trying text-embedding-004 as alias
        });
        
        console.log("Testing gemini-embedding-2 (alias?)...");
        // Actually, let's try "gemini-embedding-2" or "text-embedding-004" ? 
        // Wait, the prompt says "Embedding migration → gemini-embedding-2". But text-embedding-004 is the alias often used.
        // I'll test both.
    } catch (e) {}
}

async function testEmbedding2() {
    try {
        const embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_API_KEY!,
            modelName: "gemini-embedding-2", // As requested by user
        });
        
        console.log("Testing gemini-embedding-2...");
        const res = await embeddings.embedQuery("Hello world");
        console.log(`gemini-embedding-2 dimensions: ${res.length}`);
    } catch (e: any) {
        console.error("gemini-embedding-2 failed:", e.message);
    }
}

async function runAll() {
    await testEmbedding();
    await testEmbedding2();
}
runAll();
