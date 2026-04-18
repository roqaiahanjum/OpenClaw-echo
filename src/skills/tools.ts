// @ts-nocheck
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "dotenv";

const execAsync = promisify(exec);

config();

interface WebSearchArgs {
    query: string;
}

interface FileSystemArgs {
    fileName: string;
}

/**
 * Web Search Tool
 */
export const webSearchTool = tool(
    async ({ query }: WebSearchArgs) => {
        try {
            console.log(`[Skill] Searching the web for: ${query}`);
            
            const apiKey = process.env.TAVILY_API_KEY;
            if (!apiKey) {
                return "Error: TAVILY_API_KEY is not set. Please provide an API key to enable web search.";
            }

            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: apiKey,
                    query: query,
                    search_depth: "basic",
                    max_results: 3
                })
            });

            const data = await response.json();
            const results = data.results
                .map((r: any) => `Source: ${r.url}\nTitle: ${r.title}\nContent: ${r.content}`)
                .join("\n\n");

            return results || "No results found for that query.";
        } catch (error) {
            console.error("[Skill] WebSearch failed:", error);
            return "Failed to perform web search. Please try again later.";
        }
    },
    {
        name: "web_search",
        description: "Search the internet for real-time information, news, or specific facts.",
        schema: z.object({
            query: z.string().describe("The search query to look up on the internet.")
        })
    }
);

/**
 * Local File System Tool (Read-Only Sandbox)
 */
export const localFileSystemTool = tool(
    async ({ fileName }: FileSystemArgs) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            const filePath = path.join(sandboxDir, fileName);

            if (!filePath.startsWith(sandboxDir)) {
                return "Security Error: Access denied. You can only read files within the 'src/sandbox' directory.";
            }

            console.log(`[Skill] Reading file: ${fileName}`);
            const content = await fs.readFile(filePath, "utf-8");
            return content;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                return `Error: File '${fileName}' not found in the sandbox.`;
            }
            console.error("[Skill] LocalFileSystem failed:", error);
            return `Error reading file: ${error.message}`;
        }
    },
    {
        name: "read_sandbox_file",
        description: "Read the contents of a text-based file from the local 'sandbox' folder.",
        schema: z.object({
            fileName: z.string().describe("The name of the file to read (including extension, e.g., 'notes.txt').")
        })
    }
);

/**
 * Local File System Tool (Write-Only Sandbox)
 */
export const writeSandboxFileTool = tool(
    async ({ fileName, content }: { fileName: string, content: string }) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            const filePath = path.join(sandboxDir, fileName);

            if (!filePath.startsWith(sandboxDir)) {
                return "Security Error: Access denied. You can only write files within the 'src/sandbox' directory.";
            }

            console.log(`[Skill] Writing file: ${fileName}`);
            await fs.writeFile(filePath, content, "utf-8");
            return `Successfully wrote content to '${fileName}'.`;
        } catch (error: any) {
            console.error("[Skill] WriteFile failed:", error);
            return `Error writing file: ${error.message}`;
        }
    },
    {
        name: "write_sandbox_file",
        description: "Create or update a text-based file in the local 'sandbox' folder. Use this to save notes, logs, or user-requested data.",
        schema: z.object({
            fileName: z.string().describe("The name of the file (e.g., 'notes.txt')."),
            content: z.string().describe("The text content to save.")
        })
    }
);

/**
 * Temporal Awareness Tool
 */
export const currentTimeTool = tool(
    async () => {
        const now = new Date();
        return `Current System Time: ${now.toLocaleString()}`;
    },
    {
        name: "get_current_time",
        description: "Get the current system date and time. Use this to provide time-sensitive information."
    }
);

/**
 * Autonomous Learning Tool
 */
export const updateUserProfileTool = tool(
    async ({ key, value }: { key: string, value: string }) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            const filePath = path.join(sandboxDir, "user_profile.txt");
            const data = `[${new Date().toLocaleDateString()}] ${key}: ${value}\n`;
            
            await fs.appendFile(filePath, data, "utf-8");
            return `Successfully updated user profile with ${key}.`;
        } catch (error: any) {
            console.error("[Skill] UpdateProfile failed:", error);
            return `Error updating profile: ${error.message}`;
        }
    },
    {
        name: "update_user_profile",
        description: "Anonymously save facts about the user (e.g., preferences, profession) to enable personalized memory.",
        schema: z.object({
            key: z.string().describe("The aspect of the user (e.g. 'coding_preference')"),
            value: z.string().describe("The fact to remember.")
        })
    }
);

/**
 * Sandbox Code Execution Tool
 */
export const runSandboxCodeTool = tool(
    async ({ fileName }: { fileName: string }) => {
        try {
            const sandboxDir = path.resolve("src/sandbox");
            const filePath = path.join(sandboxDir, fileName);

            if (!filePath.startsWith(sandboxDir)) {
                return "Security Error: You can only execute files within the 'src/sandbox' directory.";
            }

            // Check if file exists
            await fs.access(filePath);

            console.log(`[Skill] Executing sandbox script: ${fileName}`);
            
            // Execute the script with a timeout
            const { stdout, stderr } = await execAsync(`node "${filePath}"`, {
                timeout: 30000, // 30 second limit
                cwd: sandboxDir
            });

            if (stderr) {
                return `Script executed with errors:\n${stderr}\nOutput:\n${stdout}`;
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
 * Autonomous Skill Synthesis Tool (Self-Evolution)
 */
export const synthesizeSkillTool = tool(
    async ({ name, description, code, schemaJSON }: { name: string, description: string, code: string, schemaJSON: string }) => {
        try {
            const dynamicDir = path.resolve("src/skills/dynamic");
            const fileName = `${name}.js`;
            const filePath = path.join(dynamicDir, fileName);

            // Construct the full tool module
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
            
            // Dynamic Load
            delete require.cache[require.resolve(filePath)];
            const dynamicModule = require(filePath);
            
            // Register with SkillRegistry (Dynamic Import to avoid circularity)
            const { SkillRegistry } = await import("./registry");
            const success = SkillRegistry.registerTool(dynamicModule.tool);

            if (success) {
                console.log(`[Evolution] New skill synthesized: ${name}`);
                return `Successfully synthesized and registered new skill: ${name}. You can now use it immediately.`;
            } else {
                return `Skill '${name}' already exists in the registry. Update failed.`;
            }
        } catch (error: any) {
            console.error("[Evolution] Synthesis failed:", error);
            return `Skill synthesis failed: ${error.message}`;
        }
    },
    {
        name: "synthesize_skill",
        description: "Synthesizes a brand new skill (tool) and registers it for future use. Use this when you determine you need a capability you don't currently possess. Code must be raw JS logic that runs inside the tool body.",
        schema: z.object({
            name: z.string().describe("Lowercase snake_case name of the tool (e.g. 'prime_checker')."),
            description: z.string().describe("Deep description of what the tool does."),
            code: z.string().describe("The internal JavaScript logic (excluding the function wrapper). Example: 'return input.a + input.b;'"),
            schemaJSON: z.string().describe("A Zod object schema definition as a string. Example: '{ a: z.number(), b: z.number() }'")
        })
    }
);

import { ProjectAnalyzer } from "../core/analyzer";

/**
 * Self-Visualization Tool (The Architect's Eye)
 */
export const visualizeArchitectureTool = tool(
    async () => {
        try {
            const diagram = await ProjectAnalyzer.generateArchitectureMap();
            console.log("[Analyzer] Architecture map generated.");
            
            return `Project Architecture Map (Mermaid Format):\n\n${diagram}\n\nArchitecture visualization has been updated on the dashboard.`;
        } catch (error: any) {
            console.error("[Analyzer] Visualization failed:", error);
            return `Failed to visualize architecture: ${error.message}`;
        }
    },
    {
        name: "visualize_architecture",
        description: "Scans the project structure and returns a Mermaid.js diagram of the agent's architecture, including skills, memory, and core components."
    }
);

import { MemoryManager } from "../memory/manager";
const memory = new MemoryManager();

/**
 * Knowledge Ingestion Tool (RAG Scholar)
 */
export const ingestKnowledgeTool = tool(
    async ({ filePath }: { filePath: string }) => {
        try {
            const absolutePath = path.resolve("src/sandbox", filePath);
            
            // Safety: Only ingest from sandbox
            const sandboxBase = path.resolve("src/sandbox");
            if (!absolutePath.startsWith(sandboxBase)) {
                return "Safety error: Knowledge ingestion is restricted to the sandbox directory.";
            }

            const content = await fs.readFile(absolutePath, "utf-8");
            const fileName = path.basename(absolutePath);

            console.log(`[Scholar] Ingesting knowledge from ${fileName}...`);
            await memory.ingestDocument(content, fileName);
            
            return `Successfully ingested '${fileName}' into your permanent knowledge base. You can now use this information in future queries.`;
        } catch (error: any) {
            console.error("[Scholar] Ingestion failed:", error);
            return `Failed to ingest document: ${error.message}`;
        }
    },
    {
        name: "ingest_to_memory",
        description: "Reads a local file from the sandbox and indexes its content into the agent's long-term semantic knowledge base for future retrieval.",
        schema: z.object({
            filePath: z.string().describe("Relative path to the file in the sandbox (e.g. 'research.txt')")
        })
    }
);

import { Visualizer } from "../core/visualizer";

/**
 * Visual Analysis Tool (The Analyst)
 */
export const generateDataChartTool = tool(
    async ({ data, title, fileName }: { data: { label: string, value: number }[], title?: string, fileName?: string }) => {
        try {
            const chartSvg = Visualizer.generateBarChart(data, title);
            const name = fileName || `insight_${Date.now()}.svg`;
            const filePath = path.join(path.resolve("src/sandbox"), name);

            await fs.writeFile(filePath, chartSvg, "utf-8");
            console.log(`[Analyst] Visual insight generated: ${name}`);
            
            return `Successfully generated visual insight: ${name}. The chart has been rendered in the Insights Gallery on the dashboard.`;
        } catch (error: any) {
            console.error("[Analyst] Visualization failed:", error);
            return `Failed to generate chart: ${error.message}`;
        }
    },
    {
        name: "generate_data_chart",
        description: "Generates a stylized SVG bar chart from a provided dataset and saves it to the sandbox for visual analysis.",
        schema: z.object({
            data: z.array(z.object({
                label: z.string().describe("Label for the data point"),
                value: z.number().describe("Numerical value for the data point")
            })).describe("The dataset to visualize"),
            title: z.string().optional().describe("Title of the chart"),
            fileName: z.string().optional().describe("Desired filename (e.g. 'growth.svg')")
        })
    }
);

/**
 * Sentinel Audit Tool (Security & Integrity)
 */
export const runSystemAuditTool = tool(
    async () => {
        try {
            console.log("[Sentinel] Initiating full system audit...");
            const auditReport = await ProjectAnalyzer.performFullSystemAudit();
            
            let reportStr = `System Audit Completed. Summary: ${auditReport.summary}\n`;
            reportStr += `Health Score: ${auditReport.score}%\n\n`;
            auditReport.checks.forEach((c: any) => {
                const icon = c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : "❌";
                reportStr += `${icon} ${c.name}: ${c.details}\n`;
            });

            return reportStr;
        } catch (error: any) {
            console.error("[Sentinel] Audit failed:", error);
            return `System Audit failed: ${error.message}`;
        }
    },
    {
        name: "run_system_audit",
        description: "Performs a comprehensive health and security check on all agent components, including AI bridges, database integrity, and sandbox isolation."
    }
);

/**
 * Herald Documentation Tool (Self-Reporting)
 */
export const generateProjectManualTool = tool(
    async () => {
        try {
            console.log("[Herald] Generating autonomous system manual...");
            const manualHtml = await ProjectAnalyzer.generateFullProjectManual();
            const filePath = path.join(path.resolve("src/sandbox"), "manual.html");

            await fs.writeFile(filePath, manualHtml, "utf-8");
            console.log("[Herald] Project manual synthesized: manual.html");
            
            return "Successfully synthesized the full project manual: manual.html. You can view it directly on the dashboard.";
        } catch (error: any) {
            console.error("[Herald] Documentation failed:", error);
            return `Manual synthesis failed: ${error.message}`;
        }
    },
    {
        name: "generate_project_manual",
        description: "Scans the entire framework and generates a comprehensive, interactive HTML manual detailing the system architecture, registered skills, and security baseline."
    }
);

import { GoalManager } from "../core/goals";
const oracle = new GoalManager();

/**
 * Oracle Planning Tool (Goal Management)
 */
export const manageProjectGoalsTool = tool(
    async ({ action, goalId, title, description, subtasks, progress, status, subtaskId, subtaskCompleted }: { 
        action: "create" | "update_progress" | "update_subtask" | "list_active", 
        goalId?: string, 
        title?: string, 
        description?: string, 
        subtasks?: string[], 
        progress?: number, 
        status?: "active" | "completed" | "failed",
        subtaskId?: string,
        subtaskCompleted?: boolean
    }) => {
        try {
            if (action === "create") {
                if (!title || !description) return "Error: Title and description required to create a goal.";
                const goal = await oracle.createGoal(title, description, subtasks);
                console.log(`[Oracle] Mission acquired: ${goal.title}`);
                return `Goal created successfully. ID: ${goal.id}`;
            } else if (action === "update_progress") {
                if (!goalId || progress === undefined) return "Error: goalId and progress required.";
                const goal = await oracle.updateGoalProgress(goalId, progress, status);
                if (goal) {
                    console.log(`[Oracle] Mission progress updated: ${goal.title} (${progress}%)`);
                    return `Goal progress updated to ${progress}%. Status: ${goal.status}`;
                }
                return "Goal not found.";
            } else if (action === "update_subtask") {
                if (!goalId || !subtaskId || subtaskCompleted === undefined) return "Error: goalId, subtaskId, and subtaskCompleted required.";
                const goal = await oracle.updateSubtask(goalId, subtaskId, subtaskCompleted);
                if (goal) {
                    console.log(`[Oracle] Mission subtask updated: ${goal.title}`);
                    return `Subtask updated. Overall progress is now ${goal.progress}%. Status: ${goal.status}`;
                }
                return "Goal or subtask not found.";
            } else if (action === "list_active") {
                const goals = await oracle.getActiveGoals();
                if (goals.length === 0) return "No active goals found.";
                return "Active Goals:\n" + goals.map((g: any) => `- [${g.id}] ${g.title} (${g.progress}%)\n  Description: ${g.description}\n  Subtasks: ${g.subtasks.map((s:any) => `[${s.completed ? 'x' : ' '}] ${s.title}`).join(', ')}`).join("\n\n");
            }
            return "Invalid action.";
        } catch (error: any) {
            console.error("[Oracle] Goal management failed:", error);
            return `Goal operation failed: ${error.message}`;
        }
    },
    {
        name: "manage_project_goals",
        description: "The Oracle Engine: Allows the agent to persistently create, update, and review long-term project goals and subtasks. Use this to maintain focus across multiple interactions.",
        schema: z.object({
            action: z.enum(["create", "update_progress", "update_subtask", "list_active"]).describe("The goal operation to perform"),
            goalId: z.string().optional().describe("ID of the goal to update"),
            title: z.string().optional().describe("Title for new goal"),
            description: z.string().optional().describe("Description for new goal"),
            subtasks: z.array(z.string()).optional().describe("List of subtask titles for new goal"),
            progress: z.number().min(0).max(100).optional().describe("Progress percentage (0-100)"),
            status: z.enum(["active", "completed", "failed"]).optional().describe("Goal status"),
            subtaskId: z.string().optional().describe("ID of subtask to update (e.g. 'sub_0')"),
            subtaskCompleted: z.boolean().optional().describe("Set subtask completion status")
        })
    }
);

import { Scraper } from "../core/scraper";

/**
 * The Explorer (Deep Web Scraping)
 */
export const scrapeWebsiteTool = tool(
    async ({ url, ingest }: { url: string, ingest?: boolean }) => {
        try {
            console.log(`[Explorer] Navigating to: ${url}`);
            const text = await Scraper.fetchCleanText(url);
            
            if (ingest) {
                console.log(`[Explorer] Ingesting scraped content into core memory...`);
                await memory.ingestDocument(text, `Source: ${url}`);
                return `Successfully scraped and ingested ${text.length} characters from ${url} into the agent's memory vault.`;
            }

            // Return preview to agent
            const previewLength = 2500; // Limit direct return size
            const preview = text.length > previewLength ? text.substring(0, previewLength) + "... [CONTENT TRUNCATED]" : text;
            return `Successfully scraped ${text.length} characters from ${url}. Content Preview:\n\n${preview}`;
        } catch (error: any) {
            console.error("[Explorer] Scraping failed:", error);
            return `Failed to scrape website: ${error.message}`;
        }
    },
    {
        name: "scrape_website",
        description: "The Explorer Engine: Fetches a URL and extracts clean, readable text. Use this to deeply read articles or documentation. Can optionally ingest the full text directly into the agent's long-term memory.",
        schema: z.object({
            url: z.string().describe("The full HTTP/HTTPS URL of the website to scrape"),
            ingest: z.boolean().optional().describe("If true, the scraped content will be permanently ingested into the agent's RAG memory vault. Useful for very long documents.")
        })
    }
);

import { SwarmOrchestrator, AgentRole } from "../core/swarm";

/**
 * The Swarm (Multi-Agent Delegation)
 */
export const delegateTaskTool = tool(
    async ({ role, task }: { role: string, task: string }) => {
        try {
            if (!["Researcher", "Coder", "Analyst", "Writer"].includes(role)) {
                return `Error: Invalid role. Must be one of: Researcher, Coder, Analyst, Writer.`;
            }
            const report = await SwarmOrchestrator.delegateTask(role as AgentRole, task);
            return report;
        } catch (error: any) {
            console.error("[Swarm] Delegation failed:", error);
            return `Task delegation failed: ${error.message}`;
        }
    },
    {
        name: "delegate_task",
        description: "The Swarm Engine: Assigns a complex, time-consuming sub-task to a highly specialized Sub-Agent. The Sub-Agent will work in parallel and return a detailed report. Use this to break down massive tasks or get expert analysis.",
        schema: z.object({
            role: z.enum(["Researcher", "Coder", "Analyst", "Writer"]).describe("The specialized persona of the Sub-Agent"),
            task: z.string().describe("A highly detailed prompt/task description for the Sub-Agent to execute")
        })
    }
);

import { Diplomat } from "../core/diplomat";

/**
 * Diplomat Email Tool (Outbound Communication)
 */
export const sendEmailReportTool = tool(
    async ({ to, subject, body }: { to: string, subject: string, body: string }) => {
        try {
            console.log(`[Diplomat] Preparing email report to: ${to}`);
            await Diplomat.sendReport({ to, subject, body });
            return `Email report successfully delivered to ${to}. Subject: "${subject}"`;
        } catch (error: any) {
            console.error("[Diplomat] Email delivery failed:", error);
            return `Email delivery failed: ${error.message}. Make sure SMTP_USER and SMTP_PASS are configured in .env`;
        }
    },
    {
        name: "send_email_report",
        description: "The Diplomat Engine: Sends a rich, professional HTML email report to a specified recipient. Use this to deliver research findings, audit results, or daily summaries to human stakeholders.",
        schema: z.object({
            to: z.string().describe("Recipient email address"),
            subject: z.string().describe("Email subject line"),
            body: z.string().describe("The full text content of the report to send")
        })
    }
);

import { Clockwork } from "../core/clockwork";

/**
 * Clockwork Scheduler Tool (Recurring Tasks)
 */
export const manageScheduledTasksTool = tool(
    async ({ action, taskId, name, description, intervalMinutes, prompt, enabled }: {
        action: "create" | "list" | "toggle" | "delete",
        taskId?: string,
        name?: string,
        description?: string,
        intervalMinutes?: number,
        prompt?: string,
        enabled?: boolean
    }) => {
        try {
            if (action === "create") {
                if (!name || !prompt || !intervalMinutes) return "Error: name, prompt, and intervalMinutes are required.";
                const task = await Clockwork.createTask(name, description || name, intervalMinutes * 60 * 1000, prompt);
                return `Scheduled task created. ID: ${task.id}. "${name}" will run every ${intervalMinutes} minutes.`;
            } else if (action === "list") {
                const tasks = await Clockwork.listTasks();
                if (tasks.length === 0) return "No scheduled tasks found.";
                return "Scheduled Tasks:\n" + tasks.map((t: any) =>
                    `- [${t.id}] ${t.name} | Every ${t.intervalMs / 60000}min | ${t.enabled ? 'ACTIVE' : 'PAUSED'} | Last: ${t.lastRun || 'Never'}`
                ).join("\n");
            } else if (action === "toggle") {
                if (!taskId || enabled === undefined) return "Error: taskId and enabled required.";
                const task = await Clockwork.toggleTask(taskId, enabled);
                return task ? `Task "${task.name}" is now ${enabled ? 'ACTIVE' : 'PAUSED'}.` : "Task not found.";
            } else if (action === "delete") {
                if (!taskId) return "Error: taskId required.";
                const ok = await Clockwork.deleteTask(taskId);
                return ok ? "Scheduled task deleted." : "Task not found.";
            }
            return "Invalid action.";
        } catch (error: any) {
            console.error("[Clockwork] Scheduler failed:", error);
            return `Scheduler operation failed: ${error.message}`;
        }
    },
    {
        name: "manage_scheduled_tasks",
        description: "The Clockwork Engine: Creates, lists, enables/disables, or deletes recurring scheduled tasks. Use this to automate periodic actions like daily audits, hourly research, or weekly email digests.",
        schema: z.object({
            action: z.enum(["create", "list", "toggle", "delete"]).describe("The scheduling operation"),
            taskId: z.string().optional().describe("ID of the task to toggle or delete"),
            name: z.string().optional().describe("Name for the new scheduled task"),
            description: z.string().optional().describe("Description of what the task does"),
            intervalMinutes: z.number().optional().describe("How often to run, in minutes (e.g. 60 = every hour, 1440 = daily)"),
            prompt: z.string().optional().describe("The full prompt to execute on each run (e.g. 'Run a system audit and email the results')"),
            enabled: z.boolean().optional().describe("Enable (true) or pause (false) a task")
        })
    }
);

import { Engineer } from "../core/engineer";

/**
 * Engineer Tool (Git Version Control)
 */
export const manageGitRepositoryTool = tool(
    async ({ action, commitMessage }: { action: "status" | "commit" | "push", commitMessage?: string }) => {
        try {
            if (action === "status") {
                return await Engineer.getStatus();
            } else if (action === "commit") {
                if (!commitMessage) return "Error: commitMessage is required for commit action.";
                return await Engineer.commitAll(commitMessage);
            } else if (action === "push") {
                return await Engineer.pushToRemote();
            }
            return "Invalid action.";
        } catch (error: any) {
            console.error("[Engineer] Git operation failed:", error);
            return `Git operation failed: ${error.message}`;
        }
    },
    {
        name: "manage_git_repository",
        description: "The Engineer Engine: Autonomously manages the Git version control repository. Use this to check workspace changes, commit modifications with a generated context message, and push to the remote.",
        schema: z.object({
            action: z.enum(["status", "commit", "push"]).describe("The Git action to perform"),
            commitMessage: z.string().optional().describe("A descriptive conventional commit message (required if action='commit')")
        })
    }
);
