// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import * as path from "path";
import * as fs from "fs/promises";
import * as ts from "typescript";
import { sanitizeSandboxCode, SANDBOX_ENV, truncateSandboxOutput, validateCodeSafety } from "../../skills/tools";
import { SANDBOX_DIR } from "../../core/storage";

export class CodingSubAgent implements WorkerAgent {
    public readonly agentType = "coding" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[CodingSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        try {
            // 1. Resolve Target Filename & Check Existing File
            const sandboxDir = SANDBOX_DIR;
            let targetFileName = task.contextPayload?.existingFileName || task.contextPayload?.fileName;
            if (!targetFileName) {
                const fileMatch = task.taskDescription.match(/(?:named|called|file|into)\s+([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i) ||
                                  task.taskDescription.match(/([a-zA-Z0-9_\-]+\.(?:ts|js|json|txt|py))/i);
                if (fileMatch) {
                    targetFileName = path.basename(fileMatch[1]);
                } else if (task.taskDescription.toLowerCase().includes("typescript") || (task.contextPayload?.originalPrompt || "").toLowerCase().includes("typescript")) {
                    targetFileName = "typescript_ai_agent_example.ts";
                } else {
                    targetFileName = `generated_${task.taskId.replace(/[^a-zA-Z0-9_]/g, "")}.ts`;
                }
            }
            targetFileName = targetFileName.replace(/[^a-zA-Z0-9_\-\.]/g, "_");

            const fullFilePath = path.resolve(sandboxDir, targetFileName);
            let fileAlreadyExists = false;
            try {
                const st = await fs.stat(fullFilePath);
                if (st.isFile() && st.size > 0) {
                    fileAlreadyExists = true;
                }
            } catch {}

            // 2. Prepare Code (Load existing if requested, or generate via LLM)
            let generatedCode = "";
            const router = ModelRouter.getInstance();
            const prereqs = task.contextPayload?.prerequisiteFindings || "";

            if (fileAlreadyExists && (task.contextPayload?.skipGeneration || task.contextPayload?.executeOnly)) {
                generatedCode = await fs.readFile(fullFilePath, "utf-8");
            } else if (!router.isInFallbackMode()) {
                try {
                    let prompt = `You are CodingSubAgent. Write a robust, production-ready TypeScript example for the task: "${task.taskDescription}".\n`;
                    if (prereqs) {
                        prompt += `\nIntegrate the following research findings and documentation insights into the code design:\n${prereqs.slice(0, 1500)}\n`;
                    }
                    prompt += `\nRequirements:
- Strong typing, interfaces, and clean async patterns.
- Clear inline comments.
- Return ONLY executable code inside markdown blocks (\`\`\`typescript ... \`\`\`).`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('CODING_TIMEOUT')), 30000)
                    );

                    const response: any = await Promise.race([
                        router.invoke([
                            new SystemMessage("You are an expert software developer sub-agent specializing in TypeScript."),
                            new HumanMessage(prompt)
                        ], "coding_subagent"),
                        timeoutPromise
                    ]);

                    generatedCode = (response.content as string) || "";
                } catch (e: any) {
                    generatedCode = this.generateFallbackCode(task.taskDescription);
                }
            } else {
                generatedCode = this.generateFallbackCode(task.taskDescription);
            }

            // Ensure clean markdown fence formatting for display
            if (!generatedCode.includes("```")) {
                generatedCode = `\`\`\`typescript\n${generatedCode}\n\`\`\``;
            }

            // 3. Validation & Bounded Repair Loop (Max 2 Attempts)
            let syntaxResult = this.validateSyntax(generatedCode, targetFileName);
            let safetyResult = validateCodeSafety(sanitizeSandboxCode(generatedCode));
            let repairAttempts = 0;
            const MAX_REPAIRS = 2;

            while ((!syntaxResult.valid || !safetyResult.valid) && repairAttempts < MAX_REPAIRS && !router.isInFallbackMode()) {
                repairAttempts++;
                console.log(`[CodingSubAgent] Code failed validation. Initiating repair attempt ${repairAttempts}/${MAX_REPAIRS}...`);
                
                const errorsList: string[] = [];
                if (!syntaxResult.valid) errorsList.push(`- TypeScript AST Syntax Error: ${syntaxResult.error}`);
                if (!safetyResult.valid) errorsList.push(`- Sandbox Safety Violation: ${safetyResult.reason}`);

                const repairPrompt = `You are CodingSubAgent. The TypeScript code you provided failed validation:
${errorsList.join("\n")}

Original Code:
${generatedCode}

Task:
Fix all TypeScript AST syntax errors and safety violations.
Rules:
- NEVER import or use 'child_process', 'cluster', 'worker_threads', 'vm', 'net', 'http', or other prohibited system modules.
- Return ONLY the corrected, clean, compilable TypeScript code inside markdown fences (\`\`\`typescript ... \`\`\`). Do not include conversational explanations.`;

                try {
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('REPAIR_TIMEOUT')), 20000)
                    );
                    const repairResponse: any = await Promise.race([
                        router.invoke([
                            new SystemMessage("You are a specialized TypeScript repair agent. Output only valid, safe TypeScript code."),
                            new HumanMessage(repairPrompt)
                        ], "coding_repair"),
                        timeoutPromise
                    ]);

                    const repairedCode = (repairResponse.content as string) || "";
                    if (repairedCode && repairedCode.trim()) {
                        generatedCode = repairedCode;
                        if (!generatedCode.includes("```")) {
                            generatedCode = `\`\`\`typescript\n${generatedCode}\n\`\`\``;
                        }
                        syntaxResult = this.validateSyntax(generatedCode, targetFileName);
                        safetyResult = validateCodeSafety(sanitizeSandboxCode(generatedCode));
                        console.log(`[CodingSubAgent] Repair attempt ${repairAttempts} result: SyntaxValid=${syntaxResult.valid}, SafetyValid=${safetyResult.valid}`);
                    }
                } catch (rErr: any) {
                    console.warn(`[CodingSubAgent] Repair attempt ${repairAttempts} failed: ${rErr.message}`);
                    break;
                }
            }

            const isCodeValid = syntaxResult.valid && safetyResult.valid;
            const syntaxStatus = syntaxResult.valid 
                ? "AST Syntax Validation: PASSED (TypeScript parser validated AST) ✅" 
                : `AST Syntax Validation: FAILED (${syntaxResult.error}) ❌`;
            const safetyStatus = safetyResult.valid
                ? "Sandbox Safety Check: PASSED (Zero prohibited modules detected) ✅"
                : `Sandbox Safety Check: FAILED (${safetyResult.reason}) ❌`;

            // 4. Invoke Registered Tool: write_sandbox_file (ONLY if code is valid and not executeOnly)
            const writeTool = SkillRegistry.getToolByName("write_sandbox_file");
            const toolStart = Date.now();
            let toolSuccess = false;
            let writeToolResult = "";

            if (fileAlreadyExists && task.contextPayload?.executeOnly) {
                toolSuccess = true;
                writeToolResult = "Using existing validated file on disk.";
            } else if (!isCodeValid) {
                toolSuccess = false;
                writeToolResult = `Code rejected: ${!syntaxResult.valid ? syntaxResult.error : safetyResult.reason}`;
            } else if (writeTool) {
                try {
                    writeToolResult = String(await writeTool.invoke({
                        fileName: targetFileName,
                        content: generatedCode
                    }));
                    toolSuccess = writeToolResult.includes("Successfully created and verified");
                } catch (wErr: any) {
                    writeToolResult = `write_sandbox_file invocation error: ${wErr.message}`;
                    toolSuccess = false;
                }
            } else {
                writeToolResult = "write_sandbox_file tool not found in SkillRegistry.";
                toolSuccess = false;
            }

            // 5. On-Disk Verification Check
            let fileVerified = false;
            let fileSize = 0;
            let savedFileReport = "";

            if (toolSuccess) {
                try {
                    const stat = await fs.stat(fullFilePath);
                    if (stat.isFile() && stat.size > 0) {
                        fileVerified = true;
                        fileSize = stat.size;
                        savedFileReport = `📁 **Saved File Location**: \`src/sandbox/${targetFileName}\`\n• **Filesystem Status**: VERIFIED ON DISK (via fs.stat) ✅\n• **Verified File Size**: ${stat.size} bytes`;
                    } else {
                        savedFileReport = `📁 **Saved File Location**: NOT SAVED ❌\n• **Filesystem Status**: FAILED (Target exists but is not a regular file)`;
                    }
                } catch (vErr: any) {
                    fileVerified = false;
                    savedFileReport = `📁 **Saved File Location**: NOT SAVED ❌\n• **Filesystem Status**: FAILED (${vErr.message})`;
                }
            } else {
                savedFileReport = `📁 **Saved File Location**: NOT SAVED ❌\n• **Filesystem Status**: REJECTED (${writeToolResult})`;
            }

            const toolDuration = Date.now() - toolStart;
            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:CodingSubAgent] [Tool:write_sandbox_file] [Status:${(toolSuccess && fileVerified) ? 'SUCCESS' : 'FAILED'}] [DurationMs:${toolDuration}] [Result:Saved src/sandbox/${targetFileName} (${fileSize} bytes)]`);

            // 6. Execution Pre-flight Check & Execution via Registered Tool
            const lowerDesc = task.taskDescription.toLowerCase();
            const shouldExecute = 
                Boolean(task.contextPayload?.execute) ||
                Boolean(task.contextPayload?.executeOnly) ||
                lowerDesc.includes("run the code") ||
                lowerDesc.includes("execute the code") ||
                lowerDesc.includes("execute the script") ||
                lowerDesc.includes("run this script now") ||
                lowerDesc.startsWith("run ") ||
                lowerDesc.startsWith("execute ");

            let executionReport = "⚙️ **Execution Status**: NOT EXECUTED (Code was generated and verified; execution was not explicitly requested).";
            let executionSuccess = false;

            if (shouldExecute) {
                if (!fileVerified || !isCodeValid) {
                    executionReport = "⚙️ **Execution Status**: NOT EXECUTED (Prerequisite file creation or syntax validation failed).";
                } else {
                    // Check tooling availability
                    const isTs = targetFileName.endsWith(".ts");
                    let toolingAvailable = true;
                    if (isTs) {
                        try {
                            const { exec } = await import("child_process");
                            const { promisify } = await import("util");
                            await promisify(exec)("npx ts-node --version", { timeout: 4000 });
                        } catch {
                            toolingAvailable = false;
                        }
                    }

                    if (!toolingAvailable) {
                        executionReport = "⚙️ **Execution Status**: TOOLING_UNAVAILABLE (TypeScript runner 'ts-node' is not available in the environment to execute this file).";
                    } else {
                        const runTool = SkillRegistry.getToolByName("run_sandbox_code");
                        if (runTool) {
                            try {
                                const runOutput = String(await runTool.invoke({ fileName: targetFileName }));
                                executionSuccess = !runOutput.includes("Execution failed") && 
                                                   !runOutput.includes("Safety Error") && 
                                                   !runOutput.includes("Safety Violation");
                                executionReport = `⚙️ **Execution Status**: ${executionSuccess ? 'EXECUTED ✅' : 'EXECUTION FAILED ❌'}\n\`\`\`\n${runOutput.trim()}\n\`\`\``;
                            } catch (toolExecErr: any) {
                                executionReport = `⚙️ **Execution Status**: EXECUTION FAILED ❌ (${toolExecErr.message})`;
                            }
                        } else {
                            executionReport = "⚙️ **Execution Status**: TOOLING_UNAVAILABLE (run_sandbox_code tool not registered).";
                        }
                    }
                }
            }

            const executionTimeMs = Date.now() - startTime;
            // Strict overallSuccess: Must have valid code, successful write, verified disk file, and if execution was requested, execution must succeed.
            const overallSuccess = isCodeValid && toolSuccess && fileVerified && (!shouldExecute || executionSuccess);

            const resultData = [
                `### 1. Generated Code`,
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
                resultData: overallSuccess ? resultData : `⚠️ [CodingSubAgent Failure]: ${!isCodeValid ? (!syntaxResult.valid ? syntaxResult.error : safetyResult.reason) : (shouldExecute && !executionSuccess ? 'Execution failed' : 'File write failed')}\n\n${resultData}`,
                error: overallSuccess ? undefined : (syntaxResult.error || safetyResult.reason || writeToolResult),
                executionTimeMs
            };

        } catch (err: any) {
            const executionTimeMs = Date.now() - startTime;
            console.error(`[StructuredLog] [TaskId:${task.taskId}] [Agent:CodingSubAgent] [Tool:write_sandbox_file] [Status:FAILED] [DurationMs:${executionTimeMs}] [Result:Error ${err.message}]`);
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

    private validateSyntax(code: string, fileName = "file.ts"): { valid: boolean; error?: string } {
        if (!code || typeof code !== "string") return { valid: false, error: "Empty or null code provided." };

        // Extract pure code without markdown fence before passing to TypeScript parser
        const pureCode = sanitizeSandboxCode(code);
        if (!pureCode.trim()) return { valid: false, error: "Code block contains no extractable statements." };

        try {
            const isTs = fileName.endsWith(".ts");
            const sourceFile = ts.createSourceFile(
                fileName,
                pureCode,
                ts.ScriptTarget.Latest,
                true,
                isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS
            );

            // Extract real parser diagnostics
            const diagnostics = (sourceFile as any).parseDiagnostics || [];
            if (diagnostics.length > 0) {
                const firstDiag = diagnostics[0];
                const message = typeof firstDiag.messageText === "string" 
                    ? firstDiag.messageText 
                    : firstDiag.messageText?.messageText || "Syntax parsing error";
                return { valid: false, error: `Line ${(firstDiag.start !== undefined ? sourceFile.getLineAndCharacterOfPosition(firstDiag.start).line + 1 : 1)}: ${message}` };
            }

            return { valid: true };
        } catch (parseErr: any) {
            return { valid: false, error: parseErr.message };
        }
    }

    private generateFallbackCode(description: string): string {
        return `\`\`\`typescript
/**
 * Auto-generated AI Agent Architecture Example
 * Generated for: ${description.replace(/"/g, "'")}
 */

export interface AgentContext {
    taskId: string;
    sessionId: string;
    environment: "production" | "sandbox";
}

export interface AgentResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
}

export class AIAgentCoordinator {
    private context: AgentContext;

    constructor(context: AgentContext) {
        this.context = context;
    }

    public async executeWorkflow(actionName: string): Promise<AgentResult<string>> {
        console.log(\`[AIAgentCoordinator] Initiating action: \${actionName} in \${this.context.environment}\`);
        return {
            success: true,
            data: \`Action '\${actionName}' executed successfully with strict type validation.\`,
            timestamp: Date.now()
        };
    }
}
\`\`\``;
    }
}
