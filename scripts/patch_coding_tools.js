const fs = require('fs');
const path = require('path');

const filePath = path.resolve('src/skills/tools.ts');
let raw = fs.readFileSync(filePath, 'utf8');
let code = raw.replace(/\r\n/g, '\n');

// 1. Update writeSandboxFileTool
const oldWriteTool = `export const writeSandboxFileTool = tool(
    async ({ fileName, content }: { fileName: string, content: string }) => {
        const tStart = Date.now();
        console.log(\`[StructuredLog] [Event:ToolInvoke] [Tool:write_sandbox_file] [FileName:\${fileName}]\`);
        try {
            const sandboxDir = SANDBOX_DIR;
            await fs.mkdir(sandboxDir, { recursive: true });

            const targetPath = path.resolve(sandboxDir, fileName);`;

const newWriteTool = `export const writeSandboxFileTool = tool(
    async (args: { fileName?: string; filename?: string; content: string }) => {
        const tStart = Date.now();
        const rawFileName = (args.fileName || args.filename || "").trim();
        const cleanFileName = path.basename(rawFileName);
        if (!cleanFileName) {
            return "Safety Violation: Valid fileName is required.";
        }
        console.log(\`[StructuredLog] [Event:ToolInvoke] [Tool:write_sandbox_file] [FileName:\${cleanFileName}]\`);
        try {
            const sandboxDir = SANDBOX_DIR;
            await fs.mkdir(sandboxDir, { recursive: true });

            const targetPath = path.resolve(sandboxDir, cleanFileName);`;

if (code.includes(oldWriteTool)) {
    code = code.replace(oldWriteTool, newWriteTool);
    console.log("Applied writeSandboxFileTool function signature normalization");
}

// 2. Update writeSandboxFileTool schema
const oldWriteSchema = `        schema: z.object({
            fileName: z.string().describe("Name of the file to save inside src/sandbox (e.g., 'report.txt', 'script.js')."),
            content: z.string().describe("The text content to write into the file."),
        }),`;

const newWriteSchema = `        schema: z.object({
            fileName: z.string().optional().describe("Name of the file to save inside src/sandbox (e.g., 'report.txt', 'script.js')."),
            filename: z.string().optional().describe("Alternative parameter alias for fileName."),
            content: z.string().describe("The text content to write into the file."),
        }),`;

if (code.includes(oldWriteSchema)) {
    code = code.replace(oldWriteSchema, newWriteSchema);
    console.log("Applied writeSandboxFileTool schema alias");
}

// 3. Update runSandboxCodeTool
const oldRunTool = `export const runSandboxCodeTool = tool(
    async ({ fileName }: { fileName: string }) => {
        try {
            const sandboxDir = SANDBOX_DIR;
            const cleanFileName = path.basename(fileName);
            const targetPath = path.resolve(sandboxDir, cleanFileName);`;

const newRunTool = `export const runSandboxCodeTool = tool(
    async (args: { fileName?: string; filename?: string }) => {
        try {
            const sandboxDir = SANDBOX_DIR;
            const rawFileName = (args.fileName || args.filename || "").trim();
            const cleanFileName = path.basename(rawFileName);
            if (!cleanFileName) {
                return "Safety Violation: Valid fileName is required.";
            }
            const targetPath = path.resolve(sandboxDir, cleanFileName);`;

if (code.includes(oldRunTool)) {
    code = code.replace(oldRunTool, newRunTool);
    console.log("Applied runSandboxCodeTool function signature normalization");
}

// 4. Update runSandboxCodeTool schema
const oldRunSchema = `        schema: z.object({
            fileName: z.string().describe("The name of the .js or .ts file in the sandbox (e.g., 'script.js', 'logic.ts').")
        })`;

const newRunSchema = `        schema: z.object({
            fileName: z.string().optional().describe("The name of the .js, .ts, or .py file in the sandbox (e.g., 'script.js', 'logic.ts', 'calc.py')."),
            filename: z.string().optional().describe("Alternative parameter alias for fileName.")
        })`;

if (code.includes(oldRunSchema)) {
    code = code.replace(oldRunSchema, newRunSchema);
    console.log("Applied runSandboxCodeTool schema alias");
}

fs.writeFileSync(filePath, code, 'utf8');
console.log("Successfully updated src/skills/tools.ts");

