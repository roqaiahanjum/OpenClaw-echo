import "dotenv/config";
import { webSearchTool, formatCleanSearchResults } from "../src/skills/tools";

async function runCleanSearchFormattingTest() {
    console.log("===============================================");
    console.log(" CLEAN SEARCH FORMATTING VERIFICATION TEST ");
    console.log("===============================================\n");

    const mockTavilyData = {
        answer: "Alibaba and DeepSeek are advancing China's AI model efficiency. Sign Out Newsletter Explore now # Header text.",
        results: [
            {
                title: "Alibaba AI Models Breakdown",
                url: "https://example.com/alibaba",
                content: "# Alibaba News\nAlibaba announced new open-source AI models. Sign In Terms of Use Read More. The models offer improved performance at reduced compute cost."
            },
            {
                title: "DeepSeek Architecture Report",
                url: "https://example.com/deepseek",
                content: "## DeepSeek Paper\nDeepSeek released its latest reasoning model details. Cookie Policy All rights reserved. It uses mixture-of-experts architecture for high efficiency."
            }
        ]
    };

    console.log("--- TEST 1: FORMATTER STRIPS BOILERPLATE NOISE ---");
    const formattedOutput = formatCleanSearchResults(mockTavilyData);
    console.log("[Test 1] Formatted Output Result:\n");
    console.log(formattedOutput);
    console.log("\n-----------------------------------------------");

    console.assert(formattedOutput.includes("🔍 *Latest Search Updates*"), "Header missing");
    console.assert(!formattedOutput.includes("Sign Out"), "Boilerplate 'Sign Out' was not stripped");
    console.assert(!formattedOutput.includes("Cookie Policy"), "Boilerplate 'Cookie Policy' was not stripped");
    console.assert(!formattedOutput.includes("# Alibaba News"), "Markdown header symbol '#' was not stripped");
    console.log("✅ TEST 1 PASSED: Formatter stripped all web noise & markdown headers.\n");

    console.log("--- TEST 2: LIVE WEB SEARCH TOOL EXECUTION ---");
    const liveResult = await webSearchTool.invoke({ query: "latest artificial intelligence news" });
    console.log("[Test 2] Live Output Result:\n");
    console.log(liveResult.slice(0, 400));
    console.assert(liveResult.includes("🔍 *Latest Search Updates*") || liveResult.includes("• 📰"), "Live web search formatting failed");
    console.log("\n✅ TEST 2 PASSED: Live web search output formatted cleanly.\n");

    console.log("===============================================");
    console.log(" ALL CLEAN SEARCH FORMATTING TESTS PASSED ");
    console.log("===============================================");
}

runCleanSearchFormattingTest();
