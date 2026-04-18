const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

async function listAllModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        // We can just fetch from the REST API directly since LangChain doesn't expose ListModels easily
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + process.env.GOOGLE_API_KEY);
        const data = await response.json();
        const names = data.models.map(m => m.name);
        console.log("AVAILABLE MODELS:", names);
    } catch(e) {
        console.error("FAIL:", e.message);
    }
}
listAllModels();
