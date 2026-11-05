import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { SkillRegistry } from "./src/skills/registry";
import { synthesizeSkillTool, runSandboxCodeTool, writeSandboxFileTool } from "./src/skills/tools";

async function runHardeningTests() {
    console.log("============================================================");
    console.log("RUNNING SANDBOX SECURITY HARDENING TEST SUITE");
    console.log("============================================================\n");

    let allPassed = true;

    // -------------------------------------------------------------------------
    // TEST A: Path traversal rejection in synthesize_skill
    // -------------------------------------------------------------------------
    console.log(">>> TEST A: synthesize_skill with path traversal '../../escaped'");
    try {
        const resA = String(await synthesizeSkillTool.invoke({
            name: "../../escaped",
            description: "Path traversal escape probe",
            code: "return 42;",
            schemaJSON: "{}"
        }));
        console.log(`[Result A]: ${resA}`);

        const fileEscapedRoot = path.resolve("escaped.js");
        const fileEscapedSrc = path.resolve("src", "escaped.js");
        const fileExistsOutside = fsSync.existsSync(fileEscapedRoot) || fsSync.existsSync(fileEscapedSrc);

        const passA = resA.includes("Safety Violation") && !fileExistsOutside;
        console.log(`[Validation]: Returns Safety Violation: ${resA.includes("Safety Violation")}`);
        console.log(`[Validation]: File outside sandbox exists: ${fileExistsOutside}`);
        console.log(`TEST A RESULT: ${passA ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passA) allPassed = false;
    } catch (e: any) {
        console.error(`TEST A EXCEPTION: ${e.message}`);
        allPassed = false;
    }

    // -------------------------------------------------------------------------
    // TEST B: Synthesize same skill twice -> rejection & file unchanged
    // Ensures clean-up of registry and disk so test is idempotent on repeat runs
    // -------------------------------------------------------------------------
    console.log(">>> TEST B: Synthesize duplicate skill");
    const testSkillName = "hardening_test_skill";
    const skillFilePath = path.resolve("src/sandbox/skills", `${testSkillName}.js`);
    try {
        // Pre-clean registry and file for idempotent runs
        SkillRegistry.unregisterTool(testSkillName);
        await fs.unlink(skillFilePath).catch(() => {});

        // 1st synthesis
        const resB1 = String(await synthesizeSkillTool.invoke({
            name: testSkillName,
            description: "First synthesis test",
            code: "return input.x * 2;",
            schemaJSON: "{ x: z.number() }"
        }));
        console.log(`[First Synthesis]: ${resB1}`);
        const contentB1 = await fs.readFile(skillFilePath, "utf-8");

        // 2nd synthesis with different code
        const resB2 = String(await synthesizeSkillTool.invoke({
            name: testSkillName,
            description: "Second synthesis attempt (should be rejected)",
            code: "return input.x * 9999;",
            schemaJSON: "{ x: z.number() }"
        }));
        console.log(`[Second Synthesis]: ${resB2}`);
        const contentB2 = await fs.readFile(skillFilePath, "utf-8");

        const rejected = resB2.includes("already exists in registry") || resB2.includes("already exists on disk");
        const fileUnchanged = contentB1 === contentB2 && contentB2.includes("input.x * 2");
        const passB = rejected && fileUnchanged;

        console.log(`[Validation]: Second attempt rejected: ${rejected}`);
        console.log(`[Validation]: File remains unmodified: ${fileUnchanged}`);
        console.log(`TEST B RESULT: ${passB ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passB) allPassed = false;
    } catch (e: any) {
        console.error(`TEST B EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        SkillRegistry.unregisterTool(testSkillName);
        await fs.unlink(skillFilePath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST C: Sandbox script printing process.env.GROQ_API_KEY -> undefined
    // -------------------------------------------------------------------------
    console.log(">>> TEST C: Sandbox script accessing process.env.GROQ_API_KEY");
    const scriptEnvName = "hardening_env_test.js";
    const scriptEnvPath = path.resolve("src/sandbox", scriptEnvName);
    try {
        await fs.writeFile(scriptEnvPath, "console.log(process.env.GROQ_API_KEY);", "utf-8");
        const resC = String(await runSandboxCodeTool.invoke({ fileName: scriptEnvName }));
        console.log(`[Result C]:\n${resC}`);

        const printsUndefined = resC.includes("undefined");
        const keyVal = process.env.GROQ_API_KEY;
        const keyNotLeaked = !keyVal || !resC.includes(keyVal);
        const passC = printsUndefined && keyNotLeaked;

        console.log(`[Validation]: Prints undefined: ${printsUndefined}`);
        console.log(`[Validation]: Secret not leaked: ${keyNotLeaked}`);
        console.log(`TEST C RESULT: ${passC ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passC) allPassed = false;
    } catch (e: any) {
        console.error(`TEST C EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptEnvPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST D: Sandbox script with require('child_process') -> rejected
    // -------------------------------------------------------------------------
    console.log(">>> TEST D: Sandbox script with require('child_process')");
    const scriptCpName = "hardening_cp_test.js";
    const scriptCpPath = path.resolve("src/sandbox", scriptCpName);
    try {
        await fs.writeFile(scriptCpPath, "const cp = require('child_process');\nconsole.log(cp);", "utf-8");
        const resD = String(await runSandboxCodeTool.invoke({ fileName: scriptCpName }));
        console.log(`[Result D]: ${resD}`);

        const passD = resD.includes("Safety Violation") && resD.includes("child_process");
        console.log(`[Validation]: Safety Violation emitted: ${passD}`);
        console.log(`TEST D RESULT: ${passD ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passD) allPassed = false;
    } catch (e: any) {
        console.error(`TEST D EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptCpPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST E: Script printing 200,000 chars -> output truncated to 50,000 with notice
    // -------------------------------------------------------------------------
    console.log(">>> TEST E: Script printing 200,000 characters");
    const scriptTruncName = "hardening_trunc_test.js";
    const scriptTruncPath = path.resolve("src/sandbox", scriptTruncName);
    try {
        await fs.writeFile(scriptTruncPath, "process.stdout.write('A'.repeat(200000));", "utf-8");
        const resE = String(await runSandboxCodeTool.invoke({ fileName: scriptTruncName }));
        
        const hasNotice = resE.includes("[NOTICE: Output truncated at 50000 characters for safety limits]");
        const prefix = "Script Output:\n";
        const contentAfterPrefix = resE.startsWith(prefix) ? resE.slice(prefix.length) : resE;
        const truncatedData = contentAfterPrefix.split("\n\n[NOTICE: Output truncated")[0];
        
        console.log(`[Result E]: Contains truncation notice: ${hasNotice}`);
        console.log(`[Result E]: Truncated data length: ${truncatedData.length} chars (expected: 50000)`);

        const passE = hasNotice && truncatedData.length === 50000;
        console.log(`TEST E RESULT: ${passE ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passE) allPassed = false;
    } catch (e: any) {
        console.error(`TEST E EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptTruncPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST F: Script trying network request via require('net') or http -> rejected
    // -------------------------------------------------------------------------
    console.log(">>> TEST F: Script trying network requests via net and http");
    const scriptNetName = "hardening_net_test.js";
    const scriptNetPath = path.resolve("src/sandbox", scriptNetName);
    const scriptHttpName = "hardening_http_test.js";
    const scriptHttpPath = path.resolve("src/sandbox", scriptHttpName);
    try {
        await fs.writeFile(scriptNetPath, "const net = require('net');\nnet.createServer();", "utf-8");
        const resNet = String(await runSandboxCodeTool.invoke({ fileName: scriptNetName }));
        console.log(`[Result F (net)]: ${resNet}`);

        await fs.writeFile(scriptHttpPath, "const http = require('http');\nhttp.get('http://example.com');", "utf-8");
        const resHttp = String(await runSandboxCodeTool.invoke({ fileName: scriptHttpName }));
        console.log(`[Result F (http)]: ${resHttp}`);

        const passNet = resNet.includes("Safety Violation") && resNet.includes("net");
        const passHttp = resHttp.includes("Safety Violation") && resHttp.includes("http");
        const passF = passNet && passHttp;

        console.log(`[Validation]: net rejected: ${passNet}`);
        console.log(`[Validation]: http rejected: ${passHttp}`);
        console.log(`TEST F RESULT: ${passF ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passF) allPassed = false;
    } catch (e: any) {
        console.error(`TEST F EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptNetPath).catch(() => {});
        await fs.unlink(scriptHttpPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST G: Patch 4 verification - File deleted if require() throws
    // -------------------------------------------------------------------------
    console.log(">>> TEST G: Module throws during require() -> file deleted");
    const failSkillName = "throwing_skill_err";
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
        console.log(`[Result G]: ${resG}`);
        const fileExists = fsSync.existsSync(failSkillPath);
        const passG = resG.includes("Skill synthesis failed during module import") && !fileExists;
        console.log(`[Validation]: Caught require() error: ${resG.includes("Skill synthesis failed during module import")}`);
        console.log(`[Validation]: File unlinked and does not exist on disk: ${!fileExists}`);
        console.log(`TEST G RESULT: ${passG ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passG) allPassed = false;
    } catch (e: any) {
        console.log(`[Result G handled]: ${e.message}`);
    } finally {
        SkillRegistry.unregisterTool(failSkillName);
        await fs.unlink(failSkillPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST H: Sandbox script using fetch(...) -> rejected
    // -------------------------------------------------------------------------
    console.log(">>> TEST H: Sandbox script using fetch(...)");
    const scriptFetchName = "hardening_fetch_test.js";
    const scriptFetchPath = path.resolve("src/sandbox", scriptFetchName);
    try {
        await fs.writeFile(scriptFetchPath, "fetch('https://example.com').then(r => r.text());", "utf-8");
        const resH = String(await runSandboxCodeTool.invoke({ fileName: scriptFetchName }));
        console.log(`[Result H]: ${resH}`);

        const passH = resH.includes("Safety Violation") && resH.includes("fetch");
        console.log(`[Validation]: fetch rejected: ${passH}`);
        console.log(`TEST H RESULT: ${passH ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passH) allPassed = false;
    } catch (e: any) {
        console.error(`TEST H EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptFetchPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST I: Sandbox script using require('node:child_process') -> rejected
    // -------------------------------------------------------------------------
    console.log(">>> TEST I: Sandbox script using require('node:child_process')");
    const scriptNodeCpName = "hardening_node_cp_test.js";
    const scriptNodeCpPath = path.resolve("src/sandbox", scriptNodeCpName);
    try {
        await fs.writeFile(scriptNodeCpPath, "const cp = require('node:child_process');\nconsole.log(cp);", "utf-8");
        const resI = String(await runSandboxCodeTool.invoke({ fileName: scriptNodeCpName }));
        console.log(`[Result I]: ${resI}`);

        const passI = resI.includes("Safety Violation") && resI.includes("child_process");
        console.log(`[Validation]: node:child_process rejected: ${passI}`);
        console.log(`TEST I RESULT: ${passI ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passI) allPassed = false;
    } catch (e: any) {
        console.error(`TEST I EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptNodeCpPath).catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST J: Sandbox script using dynamic import(...) -> rejected
    // -------------------------------------------------------------------------
    console.log(">>> TEST J: Sandbox script using dynamic import(...)");
    const scriptDynImportName = "hardening_dyn_import_test.js";
    const scriptDynImportPath = path.resolve("src/sandbox", scriptDynImportName);
    try {
        await fs.writeFile(scriptDynImportPath, "import('fs').then(console.log);", "utf-8");
        const resJ = String(await runSandboxCodeTool.invoke({ fileName: scriptDynImportName }));
        console.log(`[Result J]: ${resJ}`);

        const passJ = resJ.includes("Safety Violation") && resJ.includes("dynamic import");
        console.log(`[Validation]: dynamic import rejected: ${passJ}`);
        console.log(`TEST J RESULT: ${passJ ? "PASSED ✅" : "FAILED ❌"}\n`);
        if (!passJ) allPassed = false;
    } catch (e: any) {
        console.error(`TEST J EXCEPTION: ${e.message}`);
        allPassed = false;
    } finally {
        await fs.unlink(scriptDynImportPath).catch(() => {});
    }

    console.log("============================================================");
    if (allPassed) {
        console.log("🏆 ALL SANDBOX HARDENING TESTS PASSED!");
    } else {
        console.log("❌ SOME TESTS FAILED.");
    }
    console.log("============================================================");

    process.exit(allPassed ? 0 : 1);
}

runHardeningTests();
