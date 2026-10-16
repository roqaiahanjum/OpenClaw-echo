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
import { Diplomat } from "../core/diplomat";
import { GoalManager } from "../core/goals";
import { Clockwork } from "../core/clockwork";
import { SQLITE_DB_PATH, SANDBOX_DIR, ensureStorageDirectories } from "../core/storage";

const goalManager = new GoalManager();
const execAsync = promisify(exec);

/**
 * Sanitizes generated LLM output before writing to src/sandbox/ directory.
 * Removes markdown code fences, language identifiers, headers, and conversational prose.
 */
export function sanitizeSandboxCode(content: string): string {
    if (!content || typeof content !== "string") return "";

    let raw = content.trim();

    // 1. If content contains markdown code fences, extract code inside the blocks
    const codeBlockRegex = /```(?:[a-zA-Z0-9_+-]+)?\s*([\s\S]*?)```/g;
    const matches = [...raw.matchAll(codeBlockRegex)];

    if (matches.length > 0) {
        const extractedCodes = matches
            .map(m => m[1].trim())
            .filter(code => code.length > 0);

        if (extractedCodes.length > 0) {
            return extractedCodes.join("\n\n");
        }
    }

    // 2. If no valid code fences, strip out markdown headers, stray backticks, and conversational text
    let cleaned = raw
        // Remove markdown headers: e.g. ### Python Code, # Header
        .replace(/^#+\s+.*$/gm, "")
        // Remove stray code fence markers
        .replace(/```[a-zA-Z0-9_+-]*/g, "")
        // Remove leading/trailing backticks
        .replace(/^`+|`+$/g, "")
        .trim();

    return cleaned;
}

/**
 * Validates that a URL is a valid public HTTP/HTTPS URL and prevents Server-Side Request Forgery (SSRF)
 * against internal network interfaces, loopback addresses, or cloud metadata endpoints.
 */
export function isSafePublicUrl(targetUrl: string): { safe: boolean; reason?: string; parsedUrl?: URL } {
    try {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return { safe: false, reason: `Unsupported protocol '${parsed.protocol}'. Only http and https are allowed.` };
        }
        const hostname = parsed.hostname.toLowerCase();

        // Block loopback and internal hostnames
        if (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "0.0.0.0" ||
            hostname === "::1" ||
            hostname === "[::1]" ||
            hostname === "[::]" ||
            hostname === "instance-data" ||
            hostname.endsWith(".localhost") ||
            hostname.endsWith(".local") ||
            hostname.endsWith(".internal") ||
            hostname.includes("metadata")
        ) {
            return { safe: false, reason: "Access to loopback or local hostnames is forbidden." };
        }

        // Block numeric or hex representations of IP addresses
        if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
            return { safe: false, reason: "Integer and hexadecimal IP formats are forbidden." };
        }

        // Block IPv6 link-local and unique-local ranges
        if (hostname.startsWith("[") && (hostname.startsWith("[fe80:") || hostname.startsWith("[fc") || hostname.startsWith("[fd"))) {
            return { safe: false, reason: "Private IPv6 address range is forbidden." };
        }

        // IPv4 private & link-local ranges check
        const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipv4Match) {
            const octets = ipv4Match.slice(1).map(Number);
            if (octets.some(o => o < 0 || o > 255)) {
                return { safe: false, reason: "Invalid IP address." };
            }
            const [o1, o2] = octets;
            if (o1 === 10) return { safe: false, reason: "Private IP range (10.0.0.0/8) is forbidden." };
            if (o1 === 127) return { safe: false, reason: "Loopback IP range (127.0.0.0/8) is forbidden." };
            if (o1 === 169 && o2 === 254) return { safe: false, reason: "Link-local / cloud metadata IP range (169.254.0.0/16) is forbidden." };
            if (o1 === 172 && o2 >= 16 && o2 <= 31) return { safe: false, reason: "Private IP range (172.16.0.0/12) is forbidden." };
            if (o1 === 192 && o2 === 168) return { safe: false, reason: "Private IP range (192.168.0.0/16) is forbidden." };
            if (o1 === 0) return { safe: false, reason: "Current network (0.0.0.0/8) is forbidden." };
        }

        return { safe: true, parsedUrl: parsed };
    } catch (e: any) {
        return { safe: false, reason: `Invalid URL format: ${e.message}` };
    }
}

/**
 * Shared SANDBOX_ENV providing an isolated execution environment
 * with only PATH, SYSTEMROOT, TEMP, TMP, and NODE_ENV=sandbox.
 * All API keys and host secrets are strictly excluded.
 */
export const SANDBOX_ENV: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || process.env.Path || "",
    SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot || "C:\\Windows",
    SystemRoot: process.env.SYSTEMROOT || process.env.SystemRoot || "C:\\Windows",
    TEMP: process.env.TEMP || "C:\\Temp",
    TMP: process.env.TMP || "C:\\Temp",
    NODE_ENV: "sandbox"
};

export const MAX_SANDBOX_OUTPUT_CHARS = 50000;

export function truncateSandboxOutput(text: string): string {
    if (!text || text.length <= MAX_SANDBOX_OUTPUT_CHARS) {
        return text;
    }
    const truncated = text.slice(0, MAX_SANDBOX_OUTPUT_CHARS);
    return `${truncated}\n\n[NOTICE: Output truncated at ${MAX_SANDBOX_OUTPUT_CHARS} characters for safety limits]`;
}

export interface CodeSafetyResult {
    valid: boolean;
    reason?: string;
}

/**
 * Best-effort static check, not a full security boundary.
 * 
 * Inspects source code to reject dangerous Node APIs, system escape vectors,
 * and unsafe fs operations before synthesis and before sandbox execution.
 * 
 * fs Policy:
 * require/import of 'fs' or 'fs/promises' is permitted for standard file reading/writing
 * within the sandbox workspace (e.g., generating or reading data files in src/sandbox).
 * However, it is rejected if it is clearly unsafe:
 * 1. Path traversal using '..' across path segments.
 * 2. Referencing sensitive system or configuration files (.env, .git, .ssh, id_rsa).
 * 3. Referencing root, Windows system directories, or sensitive OS targets (C:\Windows, /etc, /usr, /root).
 * 4. Destructive recursive directory removals (e.g. recursive rm/rmdir).
 * 5. Operating system permission modifications (chmod, chown).
 */
export function validateCodeSafety(code: string): CodeSafetyResult {
    if (!code || typeof code !== "string") {
        return { valid: true };
    }

    // 1. Prohibited runtime modules and dangerous primitives
    const disallowedPatterns: { pattern: RegExp; name: string }[] = [
        { pattern: /\bfetch\s*\(/i, name: "fetch(" },
        { pattern: /\b(?:globalThis|window)\.fetch\b/i, name: "fetch" },
        { pattern: /\bXMLHttpRequest\b/i, name: "XMLHttpRequest" },
        { pattern: /\bWebSocket\b/i, name: "WebSocket" },
        { pattern: /\bimport\s*\(/i, name: "dynamic import(" },
        { pattern: /process\s*\.\s*binding/i, name: "process.binding" },
        { pattern: /\b(?:node:)?child_process\b/i, name: "child_process" },
        { pattern: /\b(?:node:)?cluster\b/i, name: "cluster" },
        { pattern: /\b(?:node:)?worker_threads\b/i, name: "worker_threads" },
        { pattern: /\b(?:node:)?vm\b/i, name: "vm" },
        { pattern: /\b(?:node:)?v8\b/i, name: "v8" },
        { pattern: /\b(?:node:)?net\b/i, name: "net" },
        { pattern: /\b(?:node:)?dns\b/i, name: "dns" },
        { pattern: /\b(?:node:)?tls\b/i, name: "tls" },
        { pattern: /\b(?:node:)?http2\b/i, name: "http2" },
        { pattern: /\b(?:node:)?https?\b/i, name: "http/https" },
        { pattern: /['"`]node:(?:child_process|cluster|worker_threads|vm|v8|net|https?|http2|dgram|dns|tls|fs|process)['"`]/i, name: "node:* module" },
        { pattern: /\b(?:node:)?dgram\b/i, name: "dgram" },
        { pattern: /process\s*\.\s*kill/i, name: "process.kill" },
        { pattern: /process\s*\.\s*exit/i, name: "process.exit" },
        { pattern: /eval\s*\(/i, name: "eval(" }
    ];

    for (const item of disallowedPatterns) {
        if (item.pattern.test(code)) {
            return {
                valid: false,
                reason: `Unauthorized module or operation detected: '${item.name}'`
            };
        }
    }

    // 2. Unsafe fs operations check:
    // fs is permitted for normal file read/write inside the sandbox,
    // but clearly unsafe if attempting path traversal, reading .env / system files,
    // or performing destructive operations like recursive directory removal or chmod.
    const unsafeFsPatterns: { pattern: RegExp; reason: string }[] = [
        { pattern: /['"`][^'"`]*\.\.[\\/]/i, reason: "path traversal in file operation" },
        { pattern: /['"`][^'"`]*\.(?:env|git|ssh)[^'"`]*['"`]/i, reason: "access to sensitive environment/config files" },
        { pattern: /['"`](?:\/etc|\/var|\/usr|C:\\Windows|C:\\Users)[^'"`]*['"`]/i, reason: "access to root or system directories" },
        { pattern: /\bfs(?:\/promises)?\b.*\b(?:rmdir|rm|unlink)\b.*recursive/i, reason: "destructive recursive deletion" },
        { pattern: /\b(?:chmod|chown)\b/i, reason: "filesystem permissions modification" }
    ];

    for (const item of unsafeFsPatterns) {
        if (item.pattern.test(code)) {
            return {
                valid: false,
                reason: `Unsafe filesystem operation: ${item.reason}`
            };
        }
    }

    return { valid: true };
}

/**
 * Strips script tags, style tags, and HTML boilerplate from raw HTML strings.
 */
export function stripHtmlToText(html: string): string {
    if (!html) return "";
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

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
            const realWorkspace = await fs.realpath(workspaceRoot).catch(() => workspaceRoot);
            const resolvedPath = targetPath ? path.resolve(workspaceRoot, targetPath) : workspaceRoot;

            if (!resolvedPath.startsWith(workspaceRoot)) {
                return "Safety Violation: Path is outside the workspace root.";
            }

            const realResolved = await fs.realpath(resolvedPath).catch(() => null);
            if (realResolved && !realResolved.startsWith(realWorkspace)) {
                return "Safety Violation: Symlink path escape detected.";
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
                return JSON.stringify({
                    success: true,
                    operation: "read",
                    fileName: path.basename(resolvedPath),
                    content: content
                }, null, 2);
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
        const tStart = Date.now();
        console.log(`[StructuredLog] [Event:ToolInvoke] [Tool:write_sandbox_file] [FileName:${fileName}]`);
        try {
            const sandboxDir = SANDBOX_DIR;
            await fs.mkdir(sandboxDir, { recursive: true });

            const targetPath = path.resolve(sandboxDir, fileName);

            // Path containment check against path traversal
            if (!targetPath.startsWith(sandboxDir + path.sep) && targetPath !== sandboxDir) {
                console.warn(`[StructuredLog] [Event:ToolResult] [Tool:write_sandbox_file] [Status:SecurityViolation] [Reason:PathTraversal]`);
                return "Safety Violation: Path is outside the permitted src/sandbox directory.";
            }

            // Symlink escape check
            const realSandbox = await fs.realpath(sandboxDir).catch(() => sandboxDir);
            const parentDir = path.dirname(targetPath);
            await fs.mkdir(parentDir, { recursive: true });
            const realParent = await fs.realpath(parentDir).catch(() => parentDir);
            if (!realParent.startsWith(realSandbox)) {
                console.warn(`[StructuredLog] [Event:ToolResult] [Tool:write_sandbox_file] [Status:SecurityViolation] [Reason:SymlinkEscape]`);
                return "Safety Violation: Symlink path escape detected.";
            }

            const cleanedContent = sanitizeSandboxCode(content);
            await fs.writeFile(targetPath, cleanedContent, "utf-8");

            // Explicit file existence and size verification
            const stat = await fs.stat(targetPath);
            if (!stat.isFile()) {
                throw new Error("Target was written but is not a regular file.");
            }

            // Real target symlink check
            const realTarget = await fs.realpath(targetPath).catch(() => null);
            if (!realTarget || !realTarget.startsWith(realSandbox)) {
                await fs.unlink(targetPath).catch(() => {});
                console.warn(`[StructuredLog] [Event:ToolResult] [Tool:write_sandbox_file] [Status:SecurityViolation] [Reason:SymlinkEscape]`);
                return "Safety Violation: Symlink path escape detected.";
            }

            const durationMs = Date.now() - tStart;
            console.log(`[StructuredLog] [Event:ToolResult] [Tool:write_sandbox_file] [DurationMs:${durationMs}] [Status:Success] [Bytes:${stat.size}]`);
            return `Successfully created and verified file 'src/sandbox/${path.basename(targetPath)}' (${stat.size} bytes).`;
        } catch (error: any) {
            const durationMs = Date.now() - tStart;
            console.error(`[StructuredLog] [Event:ToolResult] [Tool:write_sandbox_file] [DurationMs:${durationMs}] [Status:Failed] [Error:${error.message}]`);
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
            const sandboxDir = SANDBOX_DIR;
            const cleanFileName = path.basename(fileName);
            const targetPath = path.resolve(sandboxDir, cleanFileName);

            const realSandbox = await fs.realpath(sandboxDir).catch(() => sandboxDir);

            // Path containment check
            if (!targetPath.startsWith(sandboxDir + path.sep) && targetPath !== sandboxDir) {
                return "Safety Violation: Execution is strictly restricted to src/sandbox.";
            }

            // Explicit file existence verification before execution
            let stat;
            try {
                stat = await fs.stat(targetPath);
            } catch {
                return `Execution failed: File 'src/sandbox/${cleanFileName}' does not exist on disk.`;
            }

            if (!stat.isFile()) {
                return `Execution failed: Target 'src/sandbox/${cleanFileName}' is not a regular file.`;
            }

            // Symlink escape check
            const realTarget = await fs.realpath(targetPath).catch(() => null);
            if (!realTarget || !realTarget.startsWith(realSandbox)) {
                return "Safety Violation: Symlink path escape detected.";
            }

            if (!cleanFileName.endsWith(".js") && !cleanFileName.endsWith(".ts")) {
                return "Safety Error: Only JavaScript (.js) and TypeScript (.ts) files can be executed in the sandbox.";
            }

            // 1. Validate code safety before execution (Patch 3)
            const codeToExecute = await fs.readFile(targetPath, "utf-8");
            const safetyCheck = validateCodeSafety(codeToExecute);
            if (!safetyCheck.valid) {
                return `Safety Violation: Code validation rejected unsafe reference: ${safetyCheck.reason}`;
            }

            console.log(`[Skill] Executing file in sandbox: ${cleanFileName}`);
            const cmd = cleanFileName.endsWith(".ts")
                ? `npx ts-node "${targetPath}"`
                : `node "${targetPath}"`;

            // 2. Execute with isolated SANDBOX_ENV and 256KB maxBuffer (Patch 2)
            const { stdout, stderr } = await execAsync(cmd, {
                timeout: 8000,
                maxBuffer: 256 * 1024,
                env: SANDBOX_ENV
            });

            // 3. Truncate output at 50,000 chars with notice (Patch 2)
            const combined = `${stdout || ""}${stderr ? `\nSTDERR:\n${stderr}` : ""}`;
            const truncated = truncateSandboxOutput(combined);

            if (stderr && !stdout) {
                return `Executed with errors:\nSTDERR:\n${truncateSandboxOutput(stderr)}`;
            }

            return `Script Output:\n${truncated}`;
        } catch (error: any) {
            console.error("[Skill] CodeExecution failed:", error.message);
            if (error.stdout) {
                return `Execution error (${error.message}):\nOutput:\n${truncateSandboxOutput(error.stdout)}`;
            }
            return `Execution failed: ${error.message}`;
        }
    },
    {
        name: "run_sandbox_code",
        description: "Executes a JavaScript (.js) or TypeScript (.ts) file in the local sandbox and returns the output. Use this to perform calculations, process data, or verify logic.",
        schema: z.object({
            fileName: z.string().describe("The name of the .js or .ts file in the sandbox (e.g., 'script.js', 'logic.ts').")
        })
    }
);


/**
 * Autonomous Skill Synthesis Tool (Self-Evolution with Syntax Check & Hardened Sandbox)
 */
export const synthesizeSkillTool = tool(
    async ({ name, description, code, schemaJSON }: { name: string, description: string, code: string, schemaJSON: string }) => {
        try {
            const skillsSandboxDir = path.resolve(process.cwd(), "src", "sandbox", "skills");
            await fs.mkdir(skillsSandboxDir, { recursive: true });

            // 1. Path traversal check on input name (Patch 1)
            const rawTarget = path.resolve(skillsSandboxDir, `${name}.js`);
            if (name.includes("..") || !rawTarget.startsWith(skillsSandboxDir + path.sep)) {
                return "Safety Violation: Path traversal detected. Skill path must resolve within the skills sandbox directory.";
            }

            // 2. Sanitize name with path.basename + [^a-zA-Z0-9_-] strip (Patch 1)
            const cleanBaseName = path.basename(name).replace(/[^a-zA-Z0-9_-]/g, "");
            if (!cleanBaseName) {
                return "Safety Violation: Invalid skill name.";
            }

            // 3. path.resolve into skills sandbox dir; reject if resolved path is outside it (Patch 1)
            const filePath = path.resolve(skillsSandboxDir, `${cleanBaseName}.js`);
            if (!filePath.startsWith(skillsSandboxDir + path.sep)) {
                return "Safety Violation: Resolved skill path is outside the permitted skills sandbox directory.";
            }

            // 4. Reject if skill already exists (registry or file) BEFORE writing to disk (Patch 1)
            const { SkillRegistry } = await import("./registry");
            if (SkillRegistry.getToolByName(cleanBaseName)) {
                return `Skill '${cleanBaseName}' already exists in registry.`;
            }
            try {
                await fs.access(filePath);
                return `Skill '${cleanBaseName}' already exists on disk.`;
            } catch {
                // File does not exist yet, safe to proceed
            }

            const cleanedCode = sanitizeSandboxCode(code);

            // 5. Validate code safety before synthesis (Patch 3)
            const safetyCheck = validateCodeSafety(cleanedCode);
            if (!safetyCheck.valid) {
                return `Safety Violation: Code validation rejected unsafe reference: ${safetyCheck.reason}`;
            }

            // 6. Local Syntax Validation Check before writing file
            try {
                new Function("input", cleanedCode);
            } catch (syntaxErr: any) {
                console.error(`[Synthesis] Syntax validation failed for skill '${cleanBaseName}':`, syntaxErr.message);
                return `Skill synthesis rejected: JavaScript syntax error in code block: ${syntaxErr.message}`;
            }

            const moduleContent = `
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");

exports.tool = tool(
    async (input) => {
        ${cleanedCode}
    },
    {
        name: "${cleanBaseName}",
        description: "${description}",
        schema: z.object(${schemaJSON})
    }
);
`;

            await fs.writeFile(filePath, moduleContent, "utf-8");
            
            // 7. Dynamic module load with file deletion on throw (Patch 4)
            let dynamicModule;
            try {
                delete require.cache[require.resolve(filePath)];
                dynamicModule = require(filePath);
            } catch (reqErr: any) {
                // Patch 4: If a synthesized skill throws during require(), delete its file
                await fs.unlink(filePath).catch(() => {});
                console.error(`[Evolution] require() failed for synthesized skill '${cleanBaseName}':`, reqErr.message);
                return `Skill synthesis failed during module import: ${reqErr.message}`;
            }
            
            const success = SkillRegistry.registerTool(dynamicModule.tool);

            if (success) {
                console.log(`[Evolution] New skill synthesized and registered cleanly: ${cleanBaseName}`);
                return `Successfully synthesized and registered new skill '${cleanBaseName}' in 'src/sandbox/skills/'. You can now use it immediately.`;
            } else {
                return `Skill '${cleanBaseName}' already exists in registry.`;
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
            const sandboxBase = SANDBOX_DIR;
            const absolutePath = path.resolve(sandboxBase, filePath);
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
        try {
            const sandboxDir = SANDBOX_DIR;
            await fs.mkdir(sandboxDir, { recursive: true });

            const timestamp = Date.now();
            const fileName = `chart_${timestamp}.html`;
            const filePath = path.resolve(sandboxDir, fileName);

            let parsedData: any = [];
            try {
                parsedData = typeof dataJSON === "string" ? JSON.parse(dataJSON) : dataJSON;
            } catch (e) {
                parsedData = [];
            }

            let labels: string[] = [];
            let values: number[] = [];

            if (Array.isArray(parsedData)) {
                if (parsedData.length > 0 && typeof parsedData[0] === "object" && parsedData[0] !== null) {
                    labels = parsedData.map((item: any, idx: number) =>
                        item.label || item.category || item.name || item.x || `Item ${idx + 1}`
                    );
                    values = parsedData.map((item: any) => {
                        const val = item.value ?? item.count ?? item.y ?? Object.values(item)[1] ?? Object.values(item)[0];
                        return typeof val === "number" ? val : Number(val) || 0;
                    });
                } else {
                    labels = parsedData.map((_, idx) => `Item ${idx + 1}`);
                    values = parsedData.map(val => Number(val) || 0);
                }
            } else if (parsedData && typeof parsedData === "object") {
                if (Array.isArray(parsedData.labels) && (Array.isArray(parsedData.data) || Array.isArray(parsedData.datasets))) {
                    labels = parsedData.labels;
                    values = Array.isArray(parsedData.data) ? parsedData.data : (parsedData.datasets?.[0]?.data || []);
                } else {
                    labels = Object.keys(parsedData);
                    values = Object.values(parsedData).map(v => Number(v) || 0);
                }
            }

            const chartType = (type || "bar").toLowerCase();
            const validTypes = ["bar", "line", "pie", "doughnut", "radar", "polararea"];
            const normalizedType = validTypes.includes(chartType) ? chartType : "bar";

            const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapedTitle}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #0f172a;
            color: #f8fafc;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .chart-container {
            background-color: #1e293b;
            border-radius: 16px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
            padding: 30px;
            width: 100%;
            max-width: 800px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        h1 {
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 24px;
            text-align: center;
            color: #38bdf8;
        }
    </style>
</head>
<body>
    <div class="chart-container">
        <h1>${escapedTitle}</h1>
        <canvas id="myChart"></canvas>
    </div>
    <script>
        const ctx = document.getElementById('myChart').getContext('2d');
        new Chart(ctx, {
            type: '${normalizedType}',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: ${JSON.stringify(escapedTitle)},
                    data: ${JSON.stringify(values)},
                    backgroundColor: [
                        'rgba(56, 189, 248, 0.7)',
                        'rgba(129, 140, 248, 0.7)',
                        'rgba(244, 63, 94, 0.7)',
                        'rgba(251, 146, 60, 0.7)',
                        'rgba(74, 222, 128, 0.7)',
                        'rgba(192, 132, 252, 0.7)',
                        'rgba(250, 204, 21, 0.7)'
                    ],
                    borderColor: [
                        '#38bdf8',
                        '#818cf8',
                        '#f43f5e',
                        '#fb923c',
                        '#4ade80',
                        '#c084fc',
                        '#facc15'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        labels: {
                            color: '#94a3b8'
                        }
                    }
                },
                scales: ${['pie', 'doughnut', 'polararea'].includes(normalizedType) ? '{}' : `{
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }`}
            }
        });
    </script>
</body>
</html>`;

            await fs.writeFile(filePath, htmlContent, "utf-8");
            console.log(`[Skill] Generated data chart saved to: ${filePath}`);

            return `Chart generated successfully! Saved standalone HTML chart to file: ${filePath} (relative: src/sandbox/${fileName}). Title: "${title}" (${normalizedType} chart).`;
        } catch (error: any) {
            console.error("[Skill] generate_data_chart failed:", error);
            return `Failed to generate data chart: ${error.message}`;
        }
    },
    {
        name: "generate_data_chart",
        description: "Generates a visual data chart as a standalone HTML file inside src/sandbox/ directory.",
        schema: z.object({
            title: z.string().describe("Title of the data chart"),
            type: z.string().describe("Type of chart (e.g., 'bar', 'line', 'pie', 'doughnut')"),
            dataJSON: z.string().describe("JSON string representing data points e.g. '[{\"label\": \"Jan\", \"value\": 10}]'")
        })
    }
);

export const runSystemAuditTool = tool(
    async () => {
        const tStart = Date.now();
        console.log(`[StructuredLog] [Event:ToolInvoke] [Tool:run_system_audit]`);
        try {
            const sandboxDir = SANDBOX_DIR;
            const dbPath = SQLITE_DB_PATH;

            // 1. Real DB reachability check
            let dbOk = false;
            let dbStatus = "ONLINE & ACCESSIBLE";
            let dbFailDetail = "";
            try {
                const sqlite3 = require("sqlite3").verbose();
                const testDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);
                await new Promise<void>((resolve, reject) => {
                    testDb.get("SELECT 1", (err: any) => {
                        testDb.close();
                        if (err) reject(err);
                        else resolve();
                    });
                });
                dbOk = true;
            } catch (dbErr: any) {
                dbOk = false;
                dbFailDetail = dbErr.message || String(dbErr);
                dbStatus = `FAILED: ${dbFailDetail}`;
            }

            // 2. Real Sandbox writability check
            let sandboxOk = false;
            let sandboxStatus = "ONLINE & WRITABLE";
            let sandboxFailDetail = "";
            try {
                await fs.mkdir(sandboxDir, { recursive: true });
                const probeFile = path.resolve(sandboxDir, `.audit_probe_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.tmp`);
                await fs.writeFile(probeFile, "audit_probe_verification", "utf-8");
                await fs.unlink(probeFile);
                sandboxOk = true;
            } catch (sbErr: any) {
                sandboxOk = false;
                sandboxFailDetail = sbErr.message || String(sbErr);
                sandboxStatus = `FAILED: ${sandboxFailDetail}`;
            }

            // 3. Real Router health check
            let routerOk = false;
            let routerStatus = "ONLINE & CONFIGURED";
            let routerFailDetail = "";
            try {
                const { ModelRouter } = require("../core/router");
                const router = ModelRouter.getInstance();
                const health = await router.checkHealth();
                const connectedProviders: string[] = [];
                if (health.gemini?.status === "connected") connectedProviders.push("Gemini");
                if (health.groq?.status === "connected") connectedProviders.push("Groq");

                if (connectedProviders.length === 0) {
                    throw new Error("No upstream AI providers connected in ModelRouter");
                }
                routerOk = true;
                routerStatus = `ONLINE & HEALTHY (${connectedProviders.join(" + ")})`;
            } catch (rErr: any) {
                routerOk = false;
                routerFailDetail = rErr.message || String(rErr);
                routerStatus = `FAILED: ${routerFailDetail}`;
            }

            const checkResults = [
                { name: "Database (SQLite openclaw.db)", ok: dbOk, detail: dbFailDetail },
                { name: "Sandbox Directory (src/sandbox)", ok: sandboxOk, detail: sandboxFailDetail },
                { name: "Upstream AI Router", ok: routerOk, detail: routerFailDetail }
            ];
            const passedChecks = checkResults.filter(c => c.ok);
            const failedChecks = checkResults.filter(c => !c.ok);
            const allChecksPassed = failedChecks.length === 0;
            const passPercentage = Math.round((passedChecks.length / checkResults.length) * 100);

            const auditStatusLine = allChecksPassed
                ? `• System Audit Status: OPERATIONAL (${passPercentage}% - ${passedChecks.length}/${checkResults.length} real checks passed: DB reachable, Sandbox writable, Router healthy)`
                : `• System Audit Status: FAIL / DEGRADED (${passPercentage}% - ${passedChecks.length}/${checkResults.length} checks passed)\n` +
                  `  [FAIL Details]:\n` +
                  failedChecks.map(f => `  - ${f.name}: ${f.detail}`).join("\n");

            const durationMs = Date.now() - tStart;
            console.log(`[StructuredLog] [Event:ToolResult] [Tool:run_system_audit] [DurationMs:${durationMs}] [Status:${allChecksPassed ? "Success" : "Degraded"}]`);

            return `System Environment Audit Report:\n` +
                `• Database (SQLite openclaw.db): ${dbStatus}\n` +
                `• Sandbox Directory (src/sandbox): ${sandboxStatus}\n` +
                `• Upstream AI Router: ${routerStatus}\n` +
                `• Node.js Environment: ${process.version} (${process.platform} ${process.arch})\n` +
                `• Process Uptime: ${Math.floor(process.uptime())}s\n` +
                auditStatusLine;
        } catch (err: any) {
            return `System Audit completed with warning: ${err.message}`;
        }
    },
    {
        name: "run_system_audit",
        description: "Performs full environment health audit verifying database, filesystem, and runtime status."
    }
);

export const generateProjectManualTool = tool(
    async () => {
        const tStart = Date.now();
        console.log(`[StructuredLog] [Event:ToolInvoke] [Tool:generate_project_manual]`);
        try {
            const sandboxDir = SANDBOX_DIR;
            await fs.mkdir(sandboxDir, { recursive: true });
            const manualPath = path.resolve(sandboxDir, "manual.html");

            const manualContent = `<!DOCTYPE html>
<html>
<head><title>OpenClaw Echo System Manual</title><style>body{font-family:sans-serif;padding:2rem;background:#0f172a;color:#f8fafc;}h1{color:#38bdf8;}</style></head>
<body>
<h1>OpenClaw Echo - System Operations Manual</h1>
<p>Generated: ${new Date().toISOString()}</p>
<h2>Architecture Overview</h2>
<p>OpenClaw Echo is a multi-agent autonomous framework with 4-layer memory, ModelRouter waterfall failover, and sandbox-isolated code execution.</p>
</body>
</html>`;

            await fs.writeFile(manualPath, manualContent, "utf-8");
            const stat = await fs.stat(manualPath);
            const durationMs = Date.now() - tStart;
            console.log(`[StructuredLog] [Event:ToolResult] [Tool:generate_project_manual] [DurationMs:${durationMs}] [Status:Success] [Bytes:${stat.size}]`);
            return `Project manual synthesized and verified: 'src/sandbox/manual.html' (${stat.size} bytes).`;
        } catch (err: any) {
            return `Failed to generate project manual: ${err.message}`;
        }
    },
    {
        name: "generate_project_manual",
        description: "Generates full project system manual as an HTML document inside src/sandbox/ directory."
    }
);

export const manageProjectGoalsTool = tool(
    async ({ action, title, description, progress, status, goalId }: { action: string; title?: string; description?: string; progress?: number; status?: "active" | "completed" | "failed"; goalId?: string }) => {
        const act = action.toLowerCase().trim();
        try {
            if (act === "list" || act === "get" || act === "all") {
                const goals = await goalManager.getAllGoals();
                if (!goals || goals.length === 0) return "No project goals currently recorded in goals.json.";
                return JSON.stringify(goals, null, 2);
            }
            if (act === "create" || act === "add") {
                const goalTitle = title || "Untitled Objective";
                const goalDesc = description || "No detailed description provided";
                const newGoal = await goalManager.createGoal(goalTitle, goalDesc);
                return `Goal successfully created: [${newGoal.id}] "${newGoal.title}" (Status: ${newGoal.status}, Progress: ${newGoal.progress}%)`;
            }
            if (act === "update" || act === "progress") {
                if (!goalId) {
                    const goals = await goalManager.getAllGoals();
                    if (goals.length > 0) {
                        const updated = await goalManager.updateGoalProgress(goals[0].id, progress ?? 50, status);
                        return `Updated progress for goal [${goals[0].id}] to ${progress ?? 50}% (Status: ${updated?.status || "active"}).`;
                    }
                    return "Error: goalId is required to update a goal.";
                }
                const updated = await goalManager.updateGoalProgress(goalId, progress ?? 100, status);
                if (!updated) return `Goal with ID '${goalId}' not found.`;
                return `Successfully updated goal [${goalId}] progress to ${updated.progress}% (Status: ${updated.status}).`;
            }
            if (act === "complete") {
                const targetId = goalId || (await goalManager.getActiveGoals())[0]?.id;
                if (!targetId) return "No active goal found to mark complete.";
                const updated = await goalManager.updateGoalProgress(targetId, 100, "completed");
                return `Goal [${targetId}] marked completed (100%).`;
            }
            // Default: query all goals
            const goals = await goalManager.getAllGoals();
            return `Goal operation '${action}' processed. Current goals count: ${goals.length}.\nGoals summary:\n${JSON.stringify(goals, null, 2)}`;
        } catch (err: any) {
            return `Goal operation failed: ${err.message}`;
        }
    },
    {
        name: "manage_project_goals",
        description: "Manages persistent project goals and milestones in src/sandbox/goals.json. Actions: 'list', 'create', 'update', 'complete'.",
        schema: z.object({
            action: z.string().describe("Action to perform: 'list', 'create', 'update', or 'complete'"),
            title: z.string().optional().describe("Title for new goal"),
            description: z.string().optional().describe("Description for new goal"),
            progress: z.number().optional().describe("Progress percentage (0-100)"),
            status: z.enum(["active", "completed", "failed"]).optional().describe("Goal status"),
            goalId: z.string().optional().describe("ID of goal to update")
        })
    }
);

export const scrapeWebsiteTool = tool(
    async ({ url }: { url: string }) => {
        const tStart = Date.now();
        console.log(`[StructuredLog] [Event:ToolInvoke] [Tool:scrape_website] [TargetUrl:${url}]`);

        const check = isSafePublicUrl(url);
        if (!check.safe) {
            console.warn(`[StructuredLog] [Event:ToolResult] [Tool:scrape_website] [Status:Blocked] [Reason:${check.reason}]`);
            return `Safety Error: Access to URL blocked by SSRF guard (${check.reason}).`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenClaw/4.0 ScraperTool",
                    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9"
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const durationMs = Date.now() - tStart;
                console.warn(`[StructuredLog] [Event:ToolResult] [Tool:scrape_website] [DurationMs:${durationMs}] [Status:HttpError] [StatusCode:${response.status}]`);
                return `Failed to scrape ${url}: HTTP Error ${response.status} (${response.statusText || "Request failed"}).`;
            }

            const rawHtml = await response.text();
            const textContent = stripHtmlToText(rawHtml);
            const truncated = textContent.slice(0, 2500);

            const durationMs = Date.now() - tStart;
            console.log(`[StructuredLog] [Event:ToolResult] [Tool:scrape_website] [DurationMs:${durationMs}] [Status:Success] [Length:${truncated.length}]`);

            return `Scraped content from ${url} (${truncated.length} characters):\n\n${truncated}${textContent.length > 2500 ? "\n\n[Content truncated for context safety]" : ""}`;
        } catch (error: any) {
            clearTimeout(timeoutId);
            const durationMs = Date.now() - tStart;
            if (error.name === "AbortError" || error.message?.includes("aborted")) {
                console.warn(`[StructuredLog] [Event:ToolResult] [Tool:scrape_website] [DurationMs:${durationMs}] [Status:Timeout]`);
                return `Failed to scrape ${url}: Request timed out after 10s.`;
            }
            console.error(`[StructuredLog] [Event:ToolResult] [Tool:scrape_website] [DurationMs:${durationMs}] [Status:Failed] [Error:${error.message}]`);
            return `Failed to scrape ${url}: ${error.message}`;
        }
    },
    {
        name: "scrape_website",
        description: "Scrapes and extracts clean readable text from a public web page URL using real HTTP retrieval with SSRF safety checks.",
        schema: z.object({ url: z.string().describe("The public http or https URL to scrape.") })
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
    async ({ to, subject, body }: { to: string; subject: string; body: string }) => {
        try {
            await Diplomat.sendReport({ to, subject, body });
            return `Email sent successfully to ${to} with subject "${subject}".`;
        } catch (error: any) {
            const rawMsg = error.message || String(error);
            const pass = process.env.SMTP_PASS || "";
            const cleanPass = pass.replace(/\s+/g, "");
            let safeMsg = rawMsg;
            if (pass.length > 0) safeMsg = safeMsg.split(pass).join("*****");
            if (cleanPass.length > 0) safeMsg = safeMsg.split(cleanPass).join("*****");
            console.error(`[send_email_report] Error sending email to ${to}: ${safeMsg}`);
            return `Failed to send email report to ${to}: ${safeMsg}`;
        }
    },
    {
        name: "send_email_report",
        description: "Sends email reports via SMTP.",
        schema: z.object({
            to: z.string().email().describe("Recipient email address"),
            subject: z.string().describe("Subject of the email"),
            body: z.string().describe("Body content of the email report")
        })
    }
);

export const sendEmailTool = sendEmailReportTool;

export const manageScheduledTasksTool = tool(
    async ({ action, name, prompt, intervalMinutes, taskId }: { action: string; name?: string; prompt?: string; intervalMinutes?: number; taskId?: string }) => {
        const act = action.toLowerCase().trim();
        try {
            if (act === "list" || act === "get" || act === "all") {
                const tasks = await Clockwork.listTasks();
                if (!tasks || tasks.length === 0) return "No scheduled tasks registered in schedules.json.";
                return JSON.stringify(tasks, null, 2);
            }
            if (act === "create" || act === "add" || act === "schedule") {
                const taskName = name || `Task_${Date.now()}`;
                const taskPrompt = prompt || "System health check";
                const intervalMs = Math.max(1, intervalMinutes || 60) * 60 * 1000;
                const created = await Clockwork.createTask(taskName, `Scheduled recurring task: ${taskName}`, intervalMs, taskPrompt);
                return `Scheduled task created: [${created.id}] "${created.name}" every ${intervalMs / 1000}s.`;
            }
            if (act === "toggle" || act === "enable" || act === "disable") {
                if (!taskId) return "Error: taskId is required for toggle action.";
                const enable = act !== "disable";
                const toggled = await Clockwork.toggleTask(taskId, enable);
                if (!toggled) return `Scheduled task with ID '${taskId}' not found.`;
                return `Task [${taskId}] ${enable ? "enabled" : "disabled"} successfully.`;
            }
            if (act === "delete" || act === "remove") {
                if (!taskId) return "Error: taskId is required for delete action.";
                const deleted = await Clockwork.deleteTask(taskId);
                return deleted ? `Task [${taskId}] deleted successfully.` : `Task [${taskId}] not found.`;
            }
            const all = await Clockwork.listTasks();
            return `Scheduled tasks status: ${all.length} registered task(s).\n${JSON.stringify(all, null, 2)}`;
        } catch (err: any) {
            return `Scheduled task management error: ${err.message}`;
        }
    },
    {
        name: "manage_scheduled_tasks",
        description: "Manages persistent recurring tasks via the Clockwork engine. Actions: 'list', 'create', 'toggle', 'delete'.",
        schema: z.object({
            action: z.string().describe("Action to perform: 'list', 'create', 'toggle', or 'delete'"),
            name: z.string().optional().describe("Name of the scheduled task"),
            prompt: z.string().optional().describe("Prompt or instruction to execute periodically"),
            intervalMinutes: z.number().optional().describe("Interval in minutes between runs"),
            taskId: z.string().optional().describe("Task identifier for toggle or delete")
        })
    }
);

export const manageGitRepositoryTool = tool(
    async ({ action }: { action: string }) => {
        const act = action.toLowerCase().trim();
        try {
            let command = "";
            if (act === "status" || act.includes("status")) {
                command = "git status --short";
            } else if (act === "log" || act.includes("log") || act.includes("history")) {
                command = "git log -n 5 --oneline";
            } else if (act === "branch" || act.includes("branch")) {
                command = "git branch --show-current";
            } else if (act === "diff" || act.includes("diff")) {
                command = "git diff --stat";
            } else {
                return `Unsupported Git action: '${action}'. Supported actions are 'status', 'log', 'branch', and 'diff'.`;
            }

            const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), timeout: 5000 });
            const output = stdout.trim() || stderr.trim() || "(No output from git command)";
            return `Git command [${command}] output:\n${output}`;
        } catch (err: any) {
            return `Git operation failed: ${err.message}`;
        }
    },
    {
        name: "manage_git_repository",
        description: "Executes real Git repository inspection commands (e.g., 'status', 'log', 'branch', 'diff') in the workspace root.",
        schema: z.object({
            action: z.string().describe("Git command action to run: 'status', 'log', 'branch', or 'diff'")
        })
    }
);
