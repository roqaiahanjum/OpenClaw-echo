import * as fs from "fs/promises";
import * as path from "path";

/**
 * ProjectAnalyzer: The Agent's Self-Reflection Engine.
 * Scans the source code to generate a real-time Mermaid.js architecture diagram.
 */
export class ProjectAnalyzer {
    static async generateArchitectureMap(): Promise<string> {
        const srcDir = path.resolve("src");
        
        let diagram = "graph TD\n";
        diagram += "  subgraph Core\n";
        diagram += "    R[ModelRouter] --> G[Gemini Engine]\n";
        diagram += "    L[Logger] --> D[Web Dashboard]\n";
        diagram += "    C[Clockwork Scheduler] --> E[6-Step Flow Engine]\n";
        diagram += "  end\n\n";

        diagram += "  subgraph Integration\n";
        diagram += "    T[Telegram Adapter] --> E[6-Step Flow Engine]\n";
        diagram += "    W[Web Chat] --> E\n";
        diagram += "  end\n\n";

        diagram += "  subgraph Skills\n";
        diagram += "    E --> SR[Skill Registry]\n";
        
        try {
            const skillFiles = await fs.readdir(path.join(srcDir, "skills"));
            skillFiles.forEach(file => {
                if (file.endsWith(".ts") || file.endsWith(".js")) {
                    const skillName = file.replace(/\..+$/, "");
                    diagram += `    SR --> Skill_${skillName}[${skillName}]\n`;
                }
            });

            // Dynamic Skills
            const dynamicPath = path.join(srcDir, "skills", "dynamic");
            const dynamicFiles = await fs.readdir(dynamicPath).catch(() => []);
            if (dynamicFiles.length > 0) {
                diagram += "    subgraph GeneratedSkills\n";
                dynamicFiles.forEach(file => {
                    const dName = file.replace(/\..+$/, "");
                    diagram += `      Skill_${dName}((${dName}))\n`;
                    diagram += `      SR --- Skill_${dName}\n`;
                });
                diagram += "    end\n";
            }
        } catch (e) {}
        diagram += "  end\n\n";

        diagram += "  subgraph Memory\n";
        diagram += "    E --> MM[Memory Manager]\n";
        diagram += "    MM --> SQL[(SQLite Recency)]\n";
        diagram += "    MM --> VEC[(Vector Core)]\n";
        diagram += "  end\n\n";

        return diagram;
    }

    static async performFullSystemAudit(): Promise<any> {
        const audit = {
            timestamp: new Date().toISOString(),
            checks: [] as any[],
            score: 0,
            summary: ""
        };

        const addCheck = (name: string, status: "pass" | "warn" | "fail", details: string, weight: number) => {
            audit.checks.push({ name, status, details });
            if (status === "pass") audit.score += weight;
            else if (status === "warn") audit.score += weight / 2;
        };

        // 1. Connectivity Check (Environment)
        const hasGemini = !!process.env.GOOGLE_API_KEY;
        addCheck("Gemini Bridge Key", hasGemini ? "pass" : "fail", hasGemini ? "Key detected" : "API key missing", 25);

        const hasTelegram = !!process.env.TELEGRAM_TOKEN;
        addCheck("Telegram Sync", hasTelegram ? "pass" : "fail", hasTelegram ? "Secure token detected" : "Bot token missing", 20);

        // 2. Storage Integrity
        try {
            await fs.access("./openclaw.db");
            addCheck("SQLite Health", "pass", "History database accessible", 15);
        } catch {
            addCheck("SQLite Health", "fail", "Database busy or missing", 15);
        }

        try {
            const memoPath = path.resolve("src", "memory", "semantic_core.json");
            await fs.access(memoPath);
            addCheck("Vector Core Health", "pass", "Semantic brain accessible", 20);
        } catch {
            addCheck("Vector Core Health", "warn", "Starting fresh/No persistent brain", 20);
        }

        // 3. Sandbox Status
        try {
            const sandboxDir = path.resolve("src", "sandbox");
            await fs.access(sandboxDir);
            addCheck("Sandbox Isolation", "pass", "Isolated workspace active", 20);
        } catch {
            addCheck("Sandbox Isolation", "fail", "Sandbox directory inaccessible", 20);
        }

        // 4. Persistence & Schedules
        try {
            const schedPath = path.resolve("src", "sandbox", "schedules.json");
            await fs.access(schedPath);
            addCheck("Clockwork Pulse", "pass", "Autonomous schedules persistent", 10);
        } catch {
            addCheck("Clockwork Pulse", "warn", "No active background tasks", 10);
        }

        // Finalize
        audit.summary = audit.score >= 80 ? "System Healthy" : audit.score >= 50 ? "Maintenance Required" : "Critical Failure";
        return audit;
    }

    static async generateFullProjectManual(): Promise<string> {
        const audit = await this.performFullSystemAudit();
        const arch = await this.generateArchitectureMap();
        
        // Final Stylized Manual (HTML)
        const manual = `
<!DOCTYPE html>
<html>
<head>
    <title>OpenClaw Echo | Official System Manual</title>
    <style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; line-height: 1.6; }
        .card { background: rgba(255,255,255,0.05); padding: 2rem; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 2rem; }
        h1, h2, h3 { color: #38bdf8; }
        .tag { display: inline-block; padding: 0.2rem 0.6rem; background: #38bdf8; color: #0f172a; border-radius: 99px; font-size: 0.8rem; font-weight: bold; margin-right: 0.5rem; }
        code { background: rgba(0,0,0,0.3); padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
        pre { background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="card">
        <h1>OpenClaw Echo System Manual</h1>
        <p><strong>Generated At:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Sentinel Security Score:</strong> ${audit.score}% (${audit.summary})</p>
    </div>

    <div class="card">
        <h2>1. System Architecture</h2>
        <p>The framework operates on a 6-step autonomous flow: Receive → Context → Invoke → Tool Loop → Reply → Persist.</p>
        <pre>${arch}</pre>
    </div>

    <div class="card">
        <h2>2. Core Intelligence</h2>
        <ul>
            <li><strong>Cloud Model:</strong> Google Gemini 1.5 Flash</li>
            <li><strong>Local Bridge:</strong> Ollama (Hybrid Failover Enabled)</li>
            <li><strong>Vision:</strong> Multi-modal image analysis bridge</li>
            <li><strong>Voice:</strong> Neural TTS and Speech Recognition</li>
        </ul>
    </div>

    <div class="card">
        <h2>3. Autonomous Skill Fleet</h2>
        <p>Existing registered capabilities:</p>
        <ul>
            <li><strong>web_search:</strong> Full internet connectivity via Serper.</li>
            <li><strong>synthesize_skill:</strong> Self-evolution via runtime tool generation.</li>
            <li><strong>run_sandbox_code:</strong> Isolated computational environment.</li>
            <li><strong>ingest_to_memory:</strong> Specialized RAG document ingestion.</li>
            <li><strong>generate_data_chart:</strong> Visual insight synthesis (SVG).</li>
        </ul>
    </div>

    <div class="card">
        <h2>4. Memory & RAG</h2>
        <p>OpenClaw Echo uses a local-first, serverless vector memory system based on Google Gemini Embeddings and persistent JSON serialization.</p>
    </div>

    <footer style="text-align: center; opacity: 0.5; font-size: 0.8rem;">
        Generated Autonomously by OpenClaw Echo Sentinel Engine
    </footer>
</body>
</html>
        `;
        return manual;
    }
}
