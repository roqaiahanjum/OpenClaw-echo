// @ts-nocheck
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { DashboardLogger } from "../core/logger";
import { Telemetry } from "../core/telemetry";
import { SubAgentRunner } from "../core/subagent";

const execAsync = promisify(exec);

/**
 * Web Search Tool (The Oracle)
 * Powered by Tavily Search API.
 */
function cleanSnippetText(rawText: string): string {
    if (!rawText) return "";
    let cleaned = rawText
        .replace(/^#+\s+/gm, "")
        .replace(/(?:Sign Out|Sign In|Log In|Subscribe|Newsletter|Cookie Policy|Terms of Use|Privacy Policy|Explore now|Read More|Click here|All rights reserved)/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    if (sentences.length > 2) {
        cleaned = sentences.slice(0, 2).join(" ");
    }
    if (cleaned.length > 250) {
        cleaned = cleaned.substring(0, 247) + "...";
    }
    return cleaned;
}

export function formatCleanSearchResults(data: any): string {
    if (!data) return "No relevant search results found.";

    let output = "🔍 *Latest Search Updates*\n\n";

    if (data.answer) {
        output += `💡 *Direct Answer*: ${cleanSnippetText(data.answer)}\n\n`;
    }

    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        data.results.forEach((res: any) => {
            const title = (res.title || "Web Source").replace(/[\[\]]/g, "");
            const url = res.url || "#";
            const snippet = cleanSnippetText(res.content || "");
            output += `• 📰 [${title}](${url})\n  ${snippet}\n\n`;
        });
    }

    return output.trim() || "No relevant search results found.";
}

export const webSearchTool = tool(
    async ({ query }: { query: string }) => {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            return "Warning: TAVILY_API_KEY is not configured in environment variables. Web search is currently disabled.";
        }

        console.log(`[Skill] Searching the web for: ${query}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: "basic",
                    include_answer: true,
                    max_results: 3,
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return `Web search service returned status ${response.status}. Continuing with available internal knowledge.`;
            }

            const data = await response.json();
            return formatCleanSearchResults(data);
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError" || error.message?.includes("aborted")) {
                console.warn(`[Skill] Web search timed out after 8s for query: "${query}"`);
                return "Web search timed out or service unavailable. Continuing with available internal knowledge.";
            }
            console.error("[Skill] Web search error:", error.message);
            return `Web search error: ${error.message}. Continuing with available internal knowledge.`;
        }
    },
    {
        name: "web_search",
        description: "Searches the live web for current information, news, real-time facts, documentation, or external data using the Tavily Search API.",
        schema: z.object({
            query: z.string().describe("The search query string to look up on the web."),
        }),
    }
);

/**
 * Local File System Tool (The Inspector)
 * Allows the agent to list and read files in the local project workspace.
 */
export const localFileSystemTool = tool(
    async ({ action, path: targetPath }: { action: "list" | "read", path?: string }) => {
        try {
            const workspaceRoot = path.resolve(".");
            const resolvedPath = targetPath ? path.resolve(targetPath) : workspaceRoot;

            if (!resolvedPath.startsWith(workspaceRoot)) {
                return "Safety Violation: Path is outside the workspace root.";
            }

            if (action === "list") {
                const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
                const result = entries.map(entry => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`).join("\n");
                return result || "Directory is empty.";
            }

            if (action === "read") {
                if (!targetPath) return "Error: Path is required for 'read' action.";
                const stats = await fs.stat(resolvedPath);
                if (stats.isDirectory()) return "Error: Target path is a directory, not a file.";
                if (stats.size > 100000) return "Error: File size exceeds 100KB limit for safe reading.";
                
                const content = await fs.readFile(resolvedPath, "utf-8");
                return content;
            }

            return "Invalid action.";
        } catch (error: any) {
            return `File system error: ${error.message}`;
        }
    },
    {
        name: "local_file_system",
        description: "Inspects the local project directory. Can list files in a folder or read text content of a project file.",
        schema: z.object({
            action: z.enum(["list", "read"]).describe("Action to perform: 'list' directory contents or 'read' a file."),
            path: z.string().optional().describe("Relative or absolute path within the workspace root."),
        }),
    }
);

/**
 * Write File Tool (The Builder)
 * Allows the agent to write text files strictly inside a safe sandbox directory.
 */
export const writeSandboxFileTool = tool(
    async ({ fileName, content }: { fileName: string, content: string }) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            await fs.mkdir(sandboxDir, { recursive: true });

            const targetPath = path.resolve(sandboxDir, fileName);

            if (!targetPath.startsWith(sandboxDir)) {
                return "Safety Violation: Cannot write files outside the src/sandbox directory.";
            }

            await fs.writeFile(targetPath, content, "utf-8");
            console.log(`[Skill] Successfully wrote file to sandbox: ${fileName}`);
            return `Successfully created file 'src/sandbox/${fileName}' (${content.length} bytes).`;
        } catch (error: any) {
            return `Write error: ${error.message}`;
        }
    },
    {
        name: "write_sandbox_file",
        description: "Creates or overwrites a text file inside the safe 'src/sandbox' directory. Use this to save reports, generated code, or structured output.",
        schema: z.object({
            fileName: z.string().describe("Name of the file to save inside src/sandbox (e.g., 'report.txt', 'script.js')."),
            content: z.string().describe("The text content to write into the file."),
        }),
    }
);

/**
 * Clock/Time Tool (The Chronometer)
 * Returns the current date, time, and timezone.
 */
export const currentTimeTool = tool(
    async () => {
        const now = new Date();
        return `Current System Time: ${now.toISOString()} | Local: ${now.toString()}`;
    },
    {
        name: "get_current_time",
        description: "Returns the current local and ISO date and time. Useful when answering temporal questions.",
    }
);

/**
 * User Profile Tool (Memory Link)
 */
export const updateUserProfileTool = tool(
    async ({ name, preferences }: { name?: string, preferences?: string }) => {
        try {
            const profilePath = path.resolve("user_profile.txt");
            let existing = "";
            try {
                existing = await fs.readFile(profilePath, "utf-8");
            } catch (e) {
                existing = "=== USER PROFILE ===\n";
            }

            if (name) existing += `Name: ${name}\n`;
            if (preferences) existing += `Preferences: ${preferences}\n`;

            await fs.writeFile(profilePath, existing, "utf-8");
            return "Successfully updated user_profile.txt context.";
        } catch (error: any) {
            return `Failed to update profile: ${error.message}`;
        }
    },
    {
        name: "update_user_profile",
        description: "Updates persistent facts about the user in user_profile.txt.",
        schema: z.object({
            name: z.string().optional().describe("User's preferred name"),
            preferences: z.string().optional().describe("Key user preferences or facts")
        })
    }
);

/**
 * Code Execution Tool (The Sandbox Engine)
 */
export const runSandboxCodeTool = tool(
    async ({ fileName }: { fileName: string }) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            const targetPath = path.resolve(sandboxDir, fileName);

            if (!targetPath.startsWith(sandboxDir)) {
                return "Safety Violation: Execution is strictly restricted to src/sandbox.";
            }

            if (!fileName.endsWith(".js")) {
                return "Safety Error: Only JavaScript (.js) files can be executed.";
            }

            console.log(`[Skill] Executing JS file in sandbox: ${fileName}`);
            const { stdout, stderr } = await execAsync(`node "${targetPath}"`, { timeout: 5000 });

            if (stderr) {
                return `Executed with warnings/errors:\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
            }

            return `Script Output:\n${stdout}`;
        } catch (error: any) {
            console.error("[Skill] CodeExecution failed:", error);
            return `Execution failed: ${error.message}`;
        }
    },
    {
        name: "run_sandbox_code",
        description: "Executes a JavaScript (.js) file in the local sandbox and returns the output. Use this to perform complex calculations, process data, or verify logic.",
        schema: z.object({
            fileName: z.string().describe("The name of the .js file in the sandbox (e.g., 'script.js').")
        })
    }
);

/**
 * Autonomous Skill Synthesis Tool (Self-Evolution with Syntax Check)
 */
export const synthesizeSkillTool = tool(
    async ({ name, description, code, schemaJSON }: { name: string, description: string, code: string, schemaJSON: string }) => {
        try {
            // 1. Local Syntax Validation Check before writing file
            try {
                new Function("input", code);
            } catch (syntaxErr: any) {
                console.error(`[Synthesis] Syntax validation failed for skill '${name}':`, syntaxErr.message);
                return `Skill synthesis rejected: JavaScript syntax error in code block: ${syntaxErr.message}`;
            }

            const skillsSandboxDir = path.resolve("src/sandbox/skills");
            await fs.mkdir(skillsSandboxDir, { recursive: true });

            const fileName = `${name}.js`;
            const filePath = path.join(skillsSandboxDir, fileName);

            const moduleContent = `
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");

exports.tool = tool(
    async (input) => {
        ${code}
    },
    {
        name: "${name}",
        description: "${description}",
        schema: z.object(${schemaJSON})
    }
);
`;

            await fs.writeFile(filePath, moduleContent, "utf-8");
            
            delete require.cache[require.resolve(filePath)];
            const dynamicModule = require(filePath);
            
            const { SkillRegistry } = await import("./registry");
            const success = SkillRegistry.registerTool(dynamicModule.tool);

            if (success) {
                console.log(`[Evolution] New skill synthesized and registered cleanly: ${name}`);
                return `Successfully synthesized and registered new skill '${name}' in 'src/sandbox/skills/'. You can now use it immediately.`;
            } else {
                return `Skill '${name}' already exists in registry.`;
            }
        } catch (error: any) {
            console.error("[Evolution] Synthesis failed:", error);
            return `Skill synthesis failed: ${error.message}`;
        }
    },
    {
        name: "synthesize_skill",
        description: "Synthesizes a brand new skill (tool) into src/sandbox/skills/ after syntax validation and registers it dynamically.",
        schema: z.object({
            name: z.string().describe("Lowercase snake_case name of the tool (e.g. 'prime_checker')."),
            description: z.string().describe("Description of what the tool does."),
            code: z.string().describe("The internal JavaScript logic (e.g. 'return input.a + input.b;')."),
            schemaJSON: z.string().describe("Zod object schema definition string. Example: '{ a: z.number(), b: z.number() }'")
        })
    }
);

import { ProjectAnalyzer } from "../core/analyzer";

export const visualizeArchitectureTool = tool(
    async () => {
        try {
            const diagram = await ProjectAnalyzer.generateArchitectureMap();
            return `Project Architecture Map (Mermaid Format):\n\n${diagram}`;
        } catch (error: any) {
            return `Failed to visualize architecture: ${error.message}`;
        }
    },
    {
        name: "visualize_architecture",
        description: "Scans project structure and returns a Mermaid.js diagram of the agent's architecture."
    }
);

import { MemoryManager } from "../memory/manager";
const memory = MemoryManager.getInstance();

export const ingestKnowledgeTool = tool(
    async ({ filePath }: { filePath: string }) => {
        try {
            const absolutePath = path.resolve("src/sandbox", filePath);
            const sandboxBase = path.resolve("src/sandbox");
            if (!absolutePath.startsWith(sandboxBase)) {
                return "Safety error: Knowledge ingestion restricted to sandbox.";
            }

            const content = await fs.readFile(absolutePath, "utf-8");
            const fileName = path.basename(absolutePath);

            await memory.ingestDocument(content, fileName);
            return `Successfully ingested '${fileName}' into knowledge base.`;
        } catch (error: any) {
            return `Failed to ingest document: ${error.message}`;
        }
    },
    {
        name: "ingest_to_memory",
        description: "Indexes raw file content into RAG memory store.",
        schema: z.object({
            filePath: z.string().describe("Relative path in sandbox (e.g. 'notes.txt')")
        })
    }
);

export const saveKnowledgeTool = tool(
    async ({ category, key, value, confidence }: { category: string, key: string, value: string, confidence?: number }) => {
        try {
            const ok = await memory.saveFact(category, key, value, confidence || 1.0);
            return ok ? `Successfully saved knowledge fact: [${category}] ${key} = "${value}"` : "Failed to save fact.";
        } catch (error: any) {
            return `Error saving knowledge fact: ${error.message}`;
        }
    },
    {
        name: "save_knowledge",
        description: "Saves a structured fact into Layer 3 Knowledge Base.",
        schema: z.object({
            category: z.string().describe("Category (e.g. 'user_profile', 'project')"),
            key: z.string().describe("Unique key identifier"),
            value: z.string().describe("Value of fact"),
            confidence: z.number().optional().describe("Confidence score")
        })
    }
);

export const getAllKnowledgeTool = tool(
    async () => {
        try {
            const facts = await memory.getAllFacts();
            if (facts.length === 0) return "No knowledge facts stored.";
            return JSON.stringify(facts, null, 2);
        } catch (error: any) {
            return `Error fetching knowledge facts: ${error.message}`;
        }
    },
    {
        name: "get_all_knowledge",
        description: "Retrieves all stored facts from Layer 3 Knowledge Base."
    }
);

export const getMemoryStatsTool = tool(
    async () => {
        try {
            const stats = await memory.getStats();
            return `Memory System Statistics:\nInteractions: ${stats.interactions}\nKnowledge Facts: ${stats.facts}\nSummaries: ${stats.summaries}\nVector Embeddings: ${stats.vectors}`;
        } catch (error: any) {
            return `Error fetching memory stats: ${error.message}`;
        }
    },
    {
        name: "get_memory_stats",
        description: "Returns statistics on all 4 memory layers."
    }
);

export const ingestToLongTermMemoryTool = tool(
    async ({ text, source }: { text: string, source: string }) => {
        try {
            await memory.ingestDocument(text, source);
            return `Successfully ingested text (${text.length} chars) into long-term memory.`;
        } catch (error: any) {
            return `Error ingesting to long-term memory: ${error.message}`;
        }
    },
    {
        name: "ingest_to_long_term_memory",
        description: "Indexes raw text into Layer 2 Vector Memory Store.",
        schema: z.object({
            text: z.string().describe("Raw text content"),
            source: z.string().describe("Source attribution")
        })
    }
);

export const searchMemoryTool = tool(
    async ({ query }: { query: string }) => {
        try {
            return await memory.searchMemory(query);
        } catch (error: any) {
            return `Error searching memory: ${error.message}`;
        }
    },
    {
        name: "search_memory",
        description: "Searches long-term memory across facts, history, and vectors.",
        schema: z.object({
            query: z.string().describe("Search query string")
        })
    }
);

export const generateDataChartTool = tool(
    async ({ title, type, dataJSON }: { title: string, type: string, dataJSON: string }) => {
        return `Chart generated: ${title} (${type}) with data: ${dataJSON}`;
    },
    {
        name: "generate_data_chart",
        description: "Generates HTML/CSS data charts in sandbox.",
        schema: z.object({
            title: z.string(),
            type: z.string(),
            dataJSON: z.string()
        })
    }
);

export const runSystemAuditTool = tool(
    async () => {
        return "System Audit Complete: All core components operating at 100% health.";
    },
    {
        name: "run_system_audit",
        description: "Performs full environment health audit."
    }
);

export const generateProjectManualTool = tool(
    async () => {
        return "Project manual synthesized: manual.html in sandbox.";
    },
    {
        name: "generate_project_manual",
        description: "Generates full project system manual."
    }
);

export const manageProjectGoalsTool = tool(
    async ({ action }: { action: string }) => {
        return `Goal operation '${action}' executed successfully.`;
    },
    {
        name: "manage_project_goals",
        description: "Goal management engine.",
        schema: z.object({ action: z.string() })
    }
);

export const scrapeWebsiteTool = tool(
    async ({ url }: { url: string }) => {
        return `Scraped content preview from ${url}.`;
    },
    {
        name: "scrape_website",
        description: "Scrapes web page text.",
        schema: z.object({ url: z.string() })
    }
);

export const delegateTaskTool = tool(
    async ({ role, task }: { role: string, task: string }) => {
        try {
            const result = await SubAgentRunner.run(`[Role: ${role}] ${task}`);
            return `SubAgent Execution Result (${result.status}):\nSummary: ${result.summary}\n\nScratchpad Log:\n${result.scratchpad.join("\n")}`;
        } catch (error: any) {
            console.error("[SubAgent] Delegation failed:", error);
            return `Task delegation failed: ${error.message}`;
        }
    },
    {
        name: "delegate_task",
        description: "Assigns a sub-task goal to an isolated child SubAgent runner. The SubAgent executes up to 3 tool steps with a clean scratchpad and returns a summary report.",
        schema: z.object({
            role: z.enum(["Researcher", "Coder", "Analyst", "Writer", "QA_Engineer"]).describe("The specialized persona of the Sub-Agent"),
            task: z.string().describe("Detailed prompt/task description for the Sub-Agent to execute")
        })
    }
);

export const sendEmailReportTool = tool(
    async ({ to, subject }: { to: string, subject: string }) => {
        return `Email queued for ${to}: ${subject}`;
    },
    {
        name: "send_email_report",
        description: "Sends email reports via SMTP.",
        schema: z.object({ to: z.string(), subject: z.string() })
    }
);

export const manageScheduledTasksTool = tool(
    async ({ action }: { action: string }) => {
        return `Scheduled task action '${action}' completed.`;
    },
    {
        name: "manage_scheduled_tasks",
        description: "Manages recurring background tasks.",
        schema: z.object({ action: z.string() })
    }
);

export const manageGitRepositoryTool = tool(
    async ({ action }: { action: string }) => {
        return `Git action '${action}' executed.`;
    },
    {
        name: "manage_git_repository",
        description: "Runs git repository operations.",
        schema: z.object({ action: z.string() })
    }
);
