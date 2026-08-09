const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    try {
        const result = await genAI.listModels();
        console.log("Available Models:");
        result.models.forEach(m => console.log(m.name));
    } catch (e) {
        console.error("Error listing models:", e.message);
    }
}

listModels();
