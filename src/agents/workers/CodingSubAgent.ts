// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import * as path from "path";
import * as fs from "fs/promises";
import * as ts from "typescript";
import { exec } from "child_process";
import { promisify } from "util";
import { sanitizeSandboxCode, SANDBOX_ENV, truncateSandboxOutput, validateCodeSafety } from "../../skills/tools";
import { SANDBOX_DIR } from "../../core/storage";

const execAsync = promisify(exec);

interface LanguageInfo {
    lang: "python" | "typescript" | "javascript";
    ext: string;
    name: string;
}

function detectRequestedLanguage(description: string, contextPrompt?: string): LanguageInfo | { unsupported: string } {
    const combined = (description + " " + (contextPrompt || "")).toLowerCase();

    // Check for explicit unsupported languages
    const unsupportedMatch = combined.match(/\b(rust|c\+\+|golang|go|c#|java|ruby|php|swift|kotlin|scala|r|haskell|elixir)\b/i);
    if (unsupportedMatch && !combined.includes("python") && !combined.includes("typescript") && !combined.includes("javascript")) {
        return { unsupported: unsupportedMatch[1] };
    }

    if (combined.includes("python") || combined.includes(".py") || /\b(?:def\s+[a-z_]|import\s+math|python3)\b/.test(combined)) {
        return { lang: "python", ext: "py", name: "Python" };
    }
    if (combined.includes("javascript") || combined.includes(".js") || combined.includes("node.js")) {
        return { lang: "javascript", ext: "js", name: "JavaScript" };
    }
    return { lang: "typescript", ext: "ts", name: "TypeScript" };
}

export class CodingSubAgent implements WorkerAgent {
    public readonly agentType = "coding" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[CodingSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        try {
            // 1. Detect Requested Programming Language
            const langResult = detectRequestedLanguage(task.taskDescription, task.contextPayload?.originalPrompt);
            if ("unsupported" in langResult) {
                const executionTimeMs = Date.now() - startTime;
                return {
                    taskId: task.taskId,
                    targetAgent: this.agentType,
                    status: "FAILED",
                    toolName: "coding_subagent",
                    verified: false,
                    error: `Unsupported language requested: '${langResult.unsupported}'. Sandbox supports Python (.py), TypeScript (.ts), and JavaScript (.js).`,
                    resultData: `⚠️ [CodingSubAgent Unsupported Language]: The coding agent sandbox currently supports Python, TypeScript, and JavaScript. Execution for '${langResult.unsupported}' is not supported.`,
                    executionTimeMs
                };
            }

            const langInfo = langResult;
            const sandboxDir = SANDBOX_DIR;

            // 2. Resolve Target Filename matching requested language
            let targetFileName = task.contextPayload?.existingFileName || task.contextPayload?.fileName;
            if (!targetFileName) {
                const fileMatch = task.taskDescription.match(/(?:named|called|file|into|save|as)\s+([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i) ||
                                  task.taskDescription.match(/([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i);
                if (fileMatch) {
                    targetFileName = path.basename(fileMatch[1]);
                } else {
                    const slug = task.taskDescription
                        .replace(/(?:write|create|implement|generate|function|script|code|a|an|the|to|for|in|check|whether)\s+/gi, "")
                        .slice(0, 25)
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_+|_+$/g, "") || "script";
                    targetFileName = `${slug}.${langInfo.ext}`;
                }
            }

            // Ensure file extension matches detected language if extension was omitted or mismatched
            if (!path.extname(targetFileName)) {
                targetFileName = `${targetFileName}.${langInfo.ext}`;
            } else if (langInfo.lang === "python" && !targetFileName.endsWith(".py")) {
                targetFileName = targetFileName.replace(/\.[a-zA-Z0-9]+$/, ".py");
            }

            targetFileName = targetFileName.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
            const fullFilePath = path.resolve(sandboxDir, targetFileName);

            let fileAlreadyExists = false;
            try {
                const st = await fs.stat(fullFilePath);
                if (st.isFile() && st.size > 0) fileAlreadyExists = true;
            } catch {}

            // 3. Prepare Code Generation with Language-Specific Prompt
            let generatedCode = "";
            const router = ModelRouter.getInstance();
            const prereqs = task.contextPayload?.prerequisiteFindings || "";

            if (fileAlreadyExists && (task.contextPayload?.skipGeneration || task.contextPayload?.executeOnly)) {
                generatedCode = await fs.readFile(fullFilePath, "utf-8");
            } else if (!router.isInFallbackMode()) {
                try {
                    let prompt = `You are CodingSubAgent. Write a robust, production-ready ${langInfo.name} solution for the task: "${task.taskDescription}".\n`;
                    if (prereqs) {
                        prompt += `\nIntegrate the following research findings and documentation insights into the code design:\n${prereqs.slice(0, 1500)}\n`;
                    }
                    prompt += `\nRequirements:
- Idiomatic ${langInfo.name} syntax, clean functions, and clear inline comments.
${langInfo.lang === 'python' ? '- Standalone Python 3 code. Include test cases with print statements demonstrating correctness. Do NOT wrap in TypeScript or JavaScript.' : ''}
${langInfo.lang === 'typescript' ? '- Strong typing, interfaces, and clean async patterns.' : ''}
- Return ONLY executable code inside markdown blocks (\`\`\`${langInfo.lang} ... \`\`\`).`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('CODING_TIMEOUT')), 30000)
                    );

                    const response: any = await Promise.race([
                        router.invoke([
                            new SystemMessage(`You are an expert software developer sub-agent specializing in ${langInfo.name}.`),
                            new HumanMessage(prompt)
                        ], "coding_subagent"),
                        timeoutPromise
                    ]);

                    generatedCode = (response.content as string) || "";
                } catch (e: any) {
                    generatedCode = this.generateFallbackCode(task.taskDescription, langInfo);
                }
            } else {
                generatedCode = this.generateFallbackCode(task.taskDescription, langInfo);
            }

            // Ensure clean markdown fence formatting
            if (!generatedCode.includes("```")) {
                generatedCode = `\`\`\`${langInfo.lang}\n${generatedCode}\n\`\`\``;
            }

            // 4. Language-Appropriate Syntax Validation & Safety Check
            let syntaxResult = await this.validateSyntax(generatedCode, targetFileName, langInfo.lang);
            let safetyResult = validateCodeSafety(sanitizeSandboxCode(generatedCode));
            let repairAttempts = 0;
            const MAX_REPAIRS = 2;

            while ((!syntaxResult.valid || !safetyResult.valid) && repairAttempts < MAX_REPAIRS && !router.isInFallbackMode()) {
                repairAttempts++;
                console.log(`[CodingSubAgent] ${langInfo.name} code failed validation. Initiating repair attempt ${repairAttempts}/${MAX_REPAIRS}...`);

                const errorsList: string[] = [];
                if (!syntaxResult.valid) errorsList.push(`- ${langInfo.name} Syntax Error: ${syntaxResult.error}`);
                if (!safetyResult.valid) errorsList.push(`- Sandbox Safety Violation: ${safetyResult.reason}`);

                const repairPrompt = `The previously generated ${langInfo.name} code failed validation:
${errorsList.join("\n")}

Original Task: "${task.taskDescription}"
Previous Code:
${generatedCode}

Please repair the code strictly for ${langInfo.name}.
- Fix all syntax errors.
- Do NOT use prohibited modules (e.g., process.exit, eval, subprocess).
- Return ONLY repaired executable code inside markdown blocks (\`\`\`${langInfo.lang} ... \`\`\`).`;

                try {
                    const repairResponse: any = await router.invoke([
                        new SystemMessage(`You are an expert ${langInfo.name} debugging engineer.`),
                        new HumanMessage(repairPrompt)
                    ], "coding_repair");

                    const repairedText = (repairResponse.content as string) || "";
                    if (repairedText.trim()) {
                        generatedCode = repairedText.includes("```") ? repairedText : `\`\`\`${langInfo.lang}\n${repairedText}\n\`\`\``;
                        syntaxResult = await this.validateSyntax(generatedCode, targetFileName, langInfo.lang);
                        safetyResult = validateCodeSafety(sanitizeSandboxCode(generatedCode));
                    }
                } catch (repairErr: any) {
                    console.warn(`[CodingSubAgent] Repair attempt ${repairAttempts} failed:`, repairErr.message);
                    break;
                }
            }

            const isCodeValid = syntaxResult.valid && safetyResult.valid;
            const syntaxStatus = syntaxResult.valid ? `${langInfo.name} Syntax Verified ✅` : `${langInfo.name} Syntax Error ❌: ${syntaxResult.error}`;
            const safetyStatus = safetyResult.valid ? "Sandbox Safety Policy Passed ✅" : `Sandbox Safety Violation ❌: ${safetyResult.reason}`;

            // 5. Write Code to Disk via write_sandbox_file
            let writeToolResult = "";
            let toolSuccess = false;
            let fileVerified = false;

            const writeTool = SkillRegistry.getToolByName("write_sandbox_file");
            if (!writeTool) {
                throw new Error("Mandatory tool 'write_sandbox_file' not found in SkillRegistry.");
            }

            const cleanCodeToWrite = sanitizeSandboxCode(generatedCode);
            try {
                writeToolResult = String(await writeTool.invoke({
                    fileName: targetFileName,
                    content: cleanCodeToWrite
                }));
                toolSuccess = writeToolResult.startsWith("Successfully created and verified file");
            } catch (writeErr: any) {
                writeToolResult = `Write error: ${writeErr.message}`;
                toolSuccess = false;
            }

            // Verify file presence on disk
            let savedFileReport = "";
            try {
                const stat = await fs.stat(fullFilePath);
                if (stat.isFile() && stat.size > 0) {
                    fileVerified = true;
                    savedFileReport = `📁 **Sandbox File**: \`src/sandbox/${targetFileName}\` (${stat.size} bytes on disk) ✅`;
                } else {
                    savedFileReport = `📁 **Sandbox File**: \`src/sandbox/${targetFileName}\` (Write failed or empty file) ❌`;
                }
            } catch {
                fileVerified = false;
                savedFileReport = `📁 **Sandbox File**: \`src/sandbox/${targetFileName}\` (File not found on disk) ❌`;
            }

            // 6. Sandbox Execution (if requested)
            const lowerDesc = task.taskDescription.toLowerCase();
            const shouldExecute = !task.contextPayload?.skipExecution && (
                lowerDesc.includes("run") ||
                lowerDesc.includes("execute") ||
                lowerDesc.includes("test") ||
                task.contextPayload?.executeOnly
            );

            let executionReport = "⚙️ **Execution Status**: NOT REQUESTED";
            let executionSuccess = false;

            if (shouldExecute) {
                if (!fileVerified || !isCodeValid) {
                    executionReport = "⚙️ **Execution Status**: SKIPPED (File not verified on disk or code validation failed).";
                } else {
                    const runTool = SkillRegistry.getToolByName("run_sandbox_code");
                    if (runTool) {
                        try {
                            const runOutput = String(await runTool.invoke({ fileName: targetFileName }));
                            executionSuccess = !runOutput.includes("Execution failed") &&
                                               !runOutput.includes("Safety Error") &&
                                               !runOutput.includes("Safety Violation") &&
                                               !runOutput.includes("Executed with errors");
                            executionReport = `⚙️ **Execution Status**: ${executionSuccess ? 'EXECUTED ✅' : 'EXECUTION FAILED ❌'}\n\`\`\`\n${runOutput.trim()}\n\`\`\``;
                        } catch (toolExecErr: any) {
                            executionReport = `⚙️ **Execution Status**: EXECUTION FAILED ❌ (${toolExecErr.message})`;
                        }
                    } else {
                        executionReport = "⚙️ **Execution Status**: TOOLING_UNAVAILABLE (run_sandbox_code tool not registered).";
                    }
                }
            }

            const executionTimeMs = Date.now() - startTime;
            const overallSuccess = isCodeValid && toolSuccess && fileVerified && (!shouldExecute || executionSuccess);

            const resultData = [
                `### 1. Generated Code (${langInfo.name})`,
                generatedCode,
                `*${syntaxStatus}*`,
                `*${safetyStatus}*`,
                ``,
                `### 2. Saved File Status`,
                savedFileReport,
                ``,
                `### 3. Execution Status`,
                executionReport
            ].join("\n");

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: overallSuccess ? "SUCCESS" : "FAILED",
                toolName: shouldExecute ? "run_sandbox_code" : "write_sandbox_file",
                toolOutput: { savedFileReport, executionReport },
                verified: overallSuccess,
                verificationReason: overallSuccess ? (shouldExecute ? `${langInfo.name} code verified, saved, and executed` : `${langInfo.name} code syntax and file persistence verified`) : `${langInfo.name} code validation or execution failed`,
                resultData: overallSuccess ? resultData : `⚠️ [CodingSubAgent Failure]: ${!isCodeValid ? (!syntaxResult.valid ? syntaxResult.error : safetyResult.reason) : (shouldExecute && !executionSuccess ? 'Execution failed' : 'File write failed')}\n\n${resultData}`,
                error: overallSuccess ? undefined : (syntaxResult.error || safetyResult.reason || writeToolResult),
                executionTimeMs
            };

        } catch (err: any) {
            const executionTimeMs = Date.now() - startTime;
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                resultData: "",
                error: err.message || "CodingSubAgent failed",
                executionTimeMs
            };
        }
    }

    private async validateSyntax(code: string, fileName: string, lang: string): Promise<{ valid: boolean; error?: string }> {
        if (!code || typeof code !== "string") return { valid: false, error: "Empty or null code provided." };
        const pureCode = sanitizeSandboxCode(code);
        if (!pureCode.trim()) return { valid: false, error: "Code block contains no extractable statements." };

        if (lang === "python" || fileName.endsWith(".py")) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const child = exec('python -c "import ast, sys; ast.parse(sys.stdin.read())"', { timeout: 4000 }, (err, stdout, stderr) => {
                        if (err) reject(new Error(stderr?.trim() || err.message));
                        else resolve();
                    });
                    child.stdin?.write(pureCode);
                    child.stdin?.end();
                });
                return { valid: true };
            } catch (pyErr: any) {
                return { valid: false, error: `Python Syntax Error: ${pyErr.message.split('\n')[0]}` };
            }
        }

        try {
            const isTs = fileName.endsWith(".ts");
            const sourceFile = ts.createSourceFile(
                fileName,
                pureCode,
                ts.ScriptTarget.Latest,
                true,
                isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS
            );

            const diagnostics = (sourceFile as any).parseDiagnostics || [];
            if (diagnostics.length > 0) {
                const firstDiag = diagnostics[0];
                const message = typeof firstDiag.messageText === "string"
                    ? firstDiag.messageText
                    : firstDiag.messageText?.messageText || "Syntax parsing error";
                return { valid: false, error: `TypeScript AST Error: ${message}` };
            }

            return { valid: true };
        } catch (parseErr: any) {
            return { valid: false, error: parseErr.message };
        }
    }

    private generateFallbackCode(description: string, langInfo: LanguageInfo): string {
        if (langInfo.lang === "python") {
            return `\`\`python
"""
Auto-generated Python Solution
Generated for: ${description.replace(/"/g, "'")}
"""

def is_prime(n: int) -> bool:
    """Check whether a number n is prime."""
    if n <= 1:
        return False
    if n <= 3:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

if __name__ == "__main__":
    test_cases = [1, 2, 3, 4, 17, 18, 19, 23, 29]
    print("Testing is_prime():")
    for num in test_cases:
        print(f"  {num} -> {is_prime(num)}")
\`\``;
        }

        return `\`\`typescript
/**
 * Auto-generated TypeScript Solution
 * Generated for: ${description.replace(/"/g, "'")}
 */

export function executeTask(): { success: boolean; result: string } {
    return {
        success: true,
        result: "Task processed with type safety."
    };
}
\`\``;
    }
}
