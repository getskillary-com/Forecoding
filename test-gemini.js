
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");

// Load .env.local
dotenv.config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ Error: GEMINI_API_KEY is missing from .env.local");
    process.exit(1);
}

console.log(`🔑 Using API Key: ${apiKey.substring(0, 4)}...${apiKey.slice(-4)}`);

async function testGemini() {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

    try {
        console.log("🚀 Sending test prompt to Gemini...");
        const result = await model.generateContent("Hello! Are you working correctly?");
        const response = await result.response;
        const text = response.text();
        console.log("✅ Success! Gemini response:");
        console.log(text);
    } catch (error) {
        console.error("❌ Gemini API Error:");
        console.error(error);
    }
}

testGemini();
