import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { SkillRegistry } from "../src/skills/registry";
import { synthesizeSkillTool, runSandboxCodeTool } from "../src/skills/tools";

export interface SecurityTestResult {
    testId: string;
    name: string;
    description: string;
    status: "PASS" | "FAIL";
    durationMs: number;
    details: string;
    errorMessage?: string;
}

export interface SecurityEvaluationSummary {
    totalTests: number;
    passed: number;
    failed: number;
    passRate: number;
    results: SecurityTestResult[];
}

export async function evaluateSecurity(): Promise<SecurityEvaluationSummary> {
    console.log("=== STARTING SECURITY HARDENING EVALUATION (Tests A - J) ===");

    const results: SecurityTestResult[] = [];
    const csvRows: string[] = [
        "test_id,name,status,duration_ms,description,details,error_message"
    ];

    // Helper to log and record
    const recordResult = (testId: string, name: string, desc: string, pass: boolean, durationMs: number, details: string, error?: string) => {
        const status: "PASS" | "FAIL" = pass ? "PASS" : "FAIL";
        const rec: SecurityTestResult = {
            testId,
            name,
            description: desc,
            status,
            durationMs,
            details,
            errorMessage: error
        };
        results.push(rec);
        console.log(`[SecurityEval] ${testId}: ${status} (${durationMs}ms) - ${name}`);

        const safeDesc = `"${desc.replace(/"/g, '""')}"`;
        const safeDetails = `"${details.slice(0, 300).replace(/"/g, '""').replace(/\n/g, ' ')}"`;
        const safeErr = `"${(error || "").replace(/"/g, '""')}"`;

        csvRows.push([
            rec.testId,
            `"${rec.name}"`,
            rec.status,
            rec.durationMs,
            safeDesc,
            safeDetails,
            safeErr
        ].join(","));
    };

    // TEST A: Path traversal rejection in synthesize_skill
    {
        const t0 = Date.now();
        const testId = "TEST_A";
        const name = "synthesize_skill path traversal";
        const desc = "Rejection of path traversal '../../escaped' in skill synthesis";
        try {
            const resA = String(await synthesizeSkillTool.invoke({
                name: "../../escaped",
                description: "Path traversal escape probe",
                code: "return 42;",
                schemaJSON: "{}"
            }));
            const fileEscapedRoot = path.resolve("escaped.js");
            const fileEscapedSrc = path.resolve("src", "escaped.js");
            const fileExistsOutside = fsSync.existsSync(fileEscapedRoot) || fsSync.existsSync(fileEscapedSrc);
            const pass = resA.includes("Safety Violation") && !fileExistsOutside;
            recordResult(testId, name, desc, pass, Date.now() - t0, `Output: ${resA} | Outside file exists: ${fileExistsOutside}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        }
    }

    // TEST B: Synthesize duplicate skill
    {
        const t0 = Date.now();
        const testId = "TEST_B";
        const name = "duplicate skill synthesis rejection";
        const desc = "Second synthesis of existing skill is rejected and original file unchanged";
        const testSkillName = "eval_sec_dup_skill";
        const skillFilePath = path.resolve("src/sandbox/skills", `${testSkillName}.js`);
        try {
            SkillRegistry.unregisterTool(testSkillName);
            await fs.unlink(skillFilePath).catch(() => {});

            await synthesizeSkillTool.invoke({
                name: testSkillName,
                description: "First synthesis",
                code: "return input.x * 2;",
                schemaJSON: "{ x: z.number() }"
            });
            const contentB1 = await fs.readFile(skillFilePath, "utf-8");

            const resB2 = String(await synthesizeSkillTool.invoke({
                name: testSkillName,
                description: "Second synthesis attempt",
                code: "return input.x * 9999;",
                schemaJSON: "{ x: z.number() }"
            }));
            const contentB2 = await fs.readFile(skillFilePath, "utf-8");

            const rejected = resB2.includes("already exists in registry") || resB2.includes("already exists on disk");
            const fileUnchanged = contentB1 === contentB2 && contentB2.includes("input.x * 2");
            const pass = rejected && fileUnchanged;
            recordResult(testId, name, desc, pass, Date.now() - t0, `Second attempt rejected: ${rejected}, fileUnchanged: ${fileUnchanged}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            SkillRegistry.unregisterTool(testSkillName);
            await fs.unlink(skillFilePath).catch(() => {});
        }
    }

    // TEST C: Sandbox script accessing process.env.GROQ_API_KEY
    {
        const t0 = Date.now();
        const testId = "TEST_C";
        const name = "SANDBOX_ENV environment isolation";
        const desc = "Ensures API keys are excluded from SANDBOX_ENV and print undefined";
        const scriptEnvName = "eval_sec_env.js";
        const scriptEnvPath = path.resolve("src/sandbox", scriptEnvName);
        try {
            await fs.writeFile(scriptEnvPath, "console.log(process.env.GROQ_API_KEY);", "utf-8");
            const resC = String(await runSandboxCodeTool.invoke({ fileName: scriptEnvName }));
            const printsUndefined = resC.includes("undefined");
            const keyVal = process.env.GROQ_API_KEY;
            const keyNotLeaked = !keyVal || !resC.includes(keyVal);
            const pass = printsUndefined && keyNotLeaked;
            recordResult(testId, name, desc, pass, Date.now() - t0, `Prints undefined: ${printsUndefined}, Secret not leaked: ${keyNotLeaked}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptEnvPath).catch(() => {});
        }
    }

    // TEST D: Sandbox script with require('child_process')
    {
        const t0 = Date.now();
        const testId = "TEST_D";
        const name = "child_process static check";
        const desc = "Rejection of child_process module in sandbox code";
        const scriptCpName = "eval_sec_cp.js";
        const scriptCpPath = path.resolve("src/sandbox", scriptCpName);
        try {
            await fs.writeFile(scriptCpPath, "const cp = require('child_process');\nconsole.log(cp);", "utf-8");
            const resD = String(await runSandboxCodeTool.invoke({ fileName: scriptCpName }));
            const pass = resD.includes("Safety Violation") && resD.includes("child_process");
            recordResult(testId, name, desc, pass, Date.now() - t0, `Output: ${resD.slice(0, 100)}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptCpPath).catch(() => {});
        }
    }

    // TEST E: Script printing 200,000 characters
    {
        const t0 = Date.now();
        const testId = "TEST_E";
        const name = "output truncation to 50k chars";
        const desc = "Verification of 50,000 character output truncation cap and safety notice";
        const scriptTruncName = "eval_sec_trunc.js";
        const scriptTruncPath = path.resolve("src/sandbox", scriptTruncName);
        try {
            await fs.writeFile(scriptTruncPath, "process.stdout.write('A'.repeat(200000));", "utf-8");
            const resE = String(await runSandboxCodeTool.invoke({ fileName: scriptTruncName }));
            const hasNotice = resE.includes("[NOTICE: Output truncated at 50000 characters for safety limits]");
            const prefix = "Script Output:\n";
            const contentAfterPrefix = resE.startsWith(prefix) ? resE.slice(prefix.length) : resE;
            const truncatedData = contentAfterPrefix.split("\n\n[NOTICE: Output truncated")[0];
            const pass = hasNotice && truncatedData.length === 50000;
            recordResult(testId, name, desc, pass, Date.now() - t0, `Has notice: ${hasNotice}, Output length: ${truncatedData.length}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptTruncPath).catch(() => {});
        }
    }

    // TEST F: Script trying network requests via net and http
    {
        const t0 = Date.now();
        const testId = "TEST_F";
        const name = "network primitives rejection (net/http)";
        const desc = "Rejection of net and http network calls in sandbox scripts";
        const scriptNetName = "eval_sec_net.js";
        const scriptNetPath = path.resolve("src/sandbox", scriptNetName);
        const scriptHttpName = "eval_sec_http.js";
        const scriptHttpPath = path.resolve("src/sandbox", scriptHttpName);
        try {
            await fs.writeFile(scriptNetPath, "const net = require('net');\nnet.createServer();", "utf-8");
            const resNet = String(await runSandboxCodeTool.invoke({ fileName: scriptNetName }));

            await fs.writeFile(scriptHttpPath, "const http = require('http');\nhttp.get('http://example.com');", "utf-8");
            const resHttp = String(await runSandboxCodeTool.invoke({ fileName: scriptHttpName }));

            const passNet = resNet.includes("Safety Violation") && resNet.includes("net");
            const passHttp = resHttp.includes("Safety Violation") && resHttp.includes("http");
            const pass = passNet && passHttp;
            recordResult(testId, name, desc, pass, Date.now() - t0, `net rejected: ${passNet}, http rejected: ${passHttp}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptNetPath).catch(() => {});
            await fs.unlink(scriptHttpPath).catch(() => {});
        }
    }

    // TEST G: Module throws during require() -> file deleted
    {
        const t0 = Date.now();
        const testId = "TEST_G";
        const name = "atomic file rollback on syntax/module error";
        const desc = "Synthesized file is unlinked if module import fails";
        const failSkillName = "eval_sec_throw";
        const failSkillPath = path.resolve("src/sandbox/skills", `${failSkillName}.js`);
        try {
            SkillRegistry.unregisterTool(failSkillName);
            await fs.unlink(failSkillPath).catch(() => {});

            const resG = String(await synthesizeSkillTool.invoke({
                name: failSkillName,
                description: "Throwing skill",
                code: "return 123;",
                schemaJSON: "{ a: (function(){ throw new Error('Schema explosion during require()'); })() }"
            }));
            const fileExists = fsSync.existsSync(failSkillPath);
            const pass = resG.includes("Skill synthesis failed during module import") && !fileExists;
            recordResult(testId, name, desc, pass, Date.now() - t0, `Handled module import error: ${resG.includes("Skill synthesis failed")}, File cleaned: ${!fileExists}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            SkillRegistry.unregisterTool(failSkillName);
            await fs.unlink(failSkillPath).catch(() => {});
        }
    }

    // TEST H: Sandbox script using fetch(...)
    {
        const t0 = Date.now();
        const testId = "TEST_H";
        const name = "fetch API rejection";
        const desc = "Rejection of fetch calls in sandbox scripts";
        const scriptFetchName = "eval_sec_fetch.js";
        const scriptFetchPath = path.resolve("src/sandbox", scriptFetchName);
        try {
            await fs.writeFile(scriptFetchPath, "fetch('https://example.com').then(r => r.text());", "utf-8");
            const resH = String(await runSandboxCodeTool.invoke({ fileName: scriptFetchName }));
            const pass = resH.includes("Safety Violation") && resH.includes("fetch");
            recordResult(testId, name, desc, pass, Date.now() - t0, `Output: ${resH.slice(0, 100)}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptFetchPath).catch(() => {});
        }
    }

    // TEST I: Sandbox script using require('node:child_process')
    {
        const t0 = Date.now();
        const testId = "TEST_I";
        const name = "node: prefix bypass rejection";
        const desc = "Rejection of node:child_process prefix import";
        const scriptNodeCpName = "eval_sec_node_cp.js";
        const scriptNodeCpPath = path.resolve("src/sandbox", scriptNodeCpName);
        try {
            await fs.writeFile(scriptNodeCpPath, "const cp = require('node:child_process');\nconsole.log(cp);", "utf-8");
            const resI = String(await runSandboxCodeTool.invoke({ fileName: scriptNodeCpName }));
            const pass = resI.includes("Safety Violation") && resI.includes("child_process");
            recordResult(testId, name, desc, pass, Date.now() - t0, `Output: ${resI.slice(0, 100)}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptNodeCpPath).catch(() => {});
        }
    }

    // TEST J: Sandbox script using dynamic import(...)
    {
        const t0 = Date.now();
        const testId = "TEST_J";
        const name = "dynamic import() rejection";
        const desc = "Rejection of dynamic import() expressions in sandbox code";
        const scriptDynImportName = "eval_sec_dyn_import.js";
        const scriptDynImportPath = path.resolve("src/sandbox", scriptDynImportName);
        try {
            await fs.writeFile(scriptDynImportPath, "import('fs').then(console.log);", "utf-8");
            const resJ = String(await runSandboxCodeTool.invoke({ fileName: scriptDynImportName }));
            const pass = resJ.includes("Safety Violation") && resJ.includes("dynamic import");
            recordResult(testId, name, desc, pass, Date.now() - t0, `Output: ${resJ.slice(0, 100)}`);
        } catch (e: any) {
            recordResult(testId, name, desc, false, Date.now() - t0, "Exception thrown", e.message);
        } finally {
            await fs.unlink(scriptDynImportPath).catch(() => {});
        }
    }

    const totalTests = results.length;
    const passed = results.filter(r => r.status === "PASS").length;
    const failed = results.filter(r => r.status === "FAIL").length;
    const passRate = (passed / totalTests) * 100;

    const csvPath = path.resolve("eval/results/security_results.csv");
    await fs.writeFile(csvPath, csvRows.join("\n"), "utf-8");
    console.log(`[SecurityEval] Results saved to ${csvPath}`);

    return {
        totalTests,
        passed,
        failed,
        passRate,
        results
    };
}

if (require.main === module) {
    evaluateSecurity().then(res => {
        console.log("\n=== SECURITY HARDENING EVALUATION RESULTS ===");
        console.log(`Total Tests: ${res.totalTests}`);
        console.log(`Passed: ${res.passed}`);
        console.log(`Failed: ${res.failed}`);
        console.log(`Pass Rate: ${res.passRate.toFixed(2)}%\n`);

        res.results.forEach(r => {
            console.log(`[${r.status}] ${r.testId}: ${r.name} (${r.durationMs}ms)`);
            if (r.status === "FAIL") {
                console.log(`   Details: ${r.details}`);
                if (r.errorMessage) console.log(`   Error: ${r.errorMessage}`);
            }
        });
    }).catch(err => {
        console.error("Security evaluation error:", err);
        process.exit(1);
    });
}
