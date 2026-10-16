import "dotenv/config";
import { ProjectAnalyzer } from "../core/analyzer";
import * as fs from "fs/promises";
import * as path from "path";

async function runAudit() {
    console.log("[Audit] Generating OpenClaw Echo System Manual...");
    const html = await ProjectAnalyzer.generateFullProjectManual();
    const outputPath = path.resolve(__dirname, "../../manual.html");
    await fs.writeFile(outputPath, html, "utf-8");
    console.log(`[Audit] System Manual successfully generated at: ${outputPath}`);
}

runAudit().catch(console.error);
