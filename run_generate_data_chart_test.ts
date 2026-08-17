import { generateDataChartTool } from "./src/skills/tools";
import * as path from "path";
import * as fs from "fs/promises";

async function runTest() {
    console.log("=== RUNNING GENERATE_DATA_CHART TOOL TESTS ===\n");

    const inputData = {
        title: "Q3 Revenue Breakdown",
        type: "bar",
        dataJSON: JSON.stringify([
            { label: "Product A", value: 15000 },
            { label: "Product B", value: 25000 },
            { label: "Product C", value: 18000 }
        ])
    };

    console.log("Invoking generate_data_chart with payload:", inputData);
    const result = await generateDataChartTool.invoke(inputData);
    console.log("\nTool Output Result:\n" + result + "\n");

    // 1. Check return string format
    if (!result.includes("Chart generated successfully") || !result.includes("src/sandbox/chart_")) {
        throw new Error("FAIL: Tool result string does not match expected output format");
    }

    // Extract file path from output
    const match = result.match(/Saved standalone HTML chart to file: (.*?) \(relative:/);
    if (!match) {
        throw new Error("FAIL: Absolute file path could not be parsed from tool output");
    }

    const absoluteFilePath = match[1].trim();
    console.log(`Parsed File Path: "${absoluteFilePath}"`);

    // 2. Verify file exists on disk
    const stats = await fs.stat(absoluteFilePath);
    if (!stats.isFile()) {
        throw new Error(`FAIL: Generated path "${absoluteFilePath}" is not a valid file`);
    }

    // 3. Verify HTML contents
    const htmlContent = await fs.readFile(absoluteFilePath, "utf-8");
    if (!htmlContent.includes("https://cdn.jsdelivr.net/npm/chart.js")) {
        throw new Error("FAIL: Generated HTML does not include Chart.js CDN link");
    }
    if (!htmlContent.includes("Q3 Revenue Breakdown") || !htmlContent.includes("Product A")) {
        throw new Error("FAIL: Generated HTML does not contain title or data labels");
    }

    console.log("File exists on disk and contains valid Chart.js HTML structure! ✅");

    // Clean up test file
    await fs.unlink(absoluteFilePath).catch(() => {});

    console.log("\n=== ALL GENERATE_DATA_CHART TESTS PASSED SUCCESSFULLY! ===");
    process.exit(0);
}

runTest().catch((err) => {
    console.error("Test suite failed:", err);
    process.exit(1);
});
