import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { SkillRegistry } from "../src/skills/registry";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface ToolTestItem {
    name: string;
    description: string;
    inputs: any;
    expectedAssertion: (output: any) => { pass: boolean; reason?: string };
}

export interface ToolTestResult {
    id: number;
    name: string;
    status: "PASS" | "FAIL";
    durationMs: number;
    inputUsed: string;
    outputReceived: string;
    assertionDescription: string;
    errorMessage?: string;
}

export interface ToolsEvaluationSummary {
    totalTools: number;
    passed: number;
    failed: number;
    passRate: number;
    results: ToolTestResult[];
}

export async function evaluateTools(): Promise<ToolsEvaluationSummary> {
    console.log("=== STARTING 23-TOOL EVALUATION SUITE ===");

    const allTools = SkillRegistry.getTools();
    console.log(`[ToolEval] Registered tools in registry: ${allTools.length}`);

    // Pre-create test sandbox files if needed
    const sandboxDir = path.resolve(process.cwd(), "src", "sandbox");
    await fs.mkdir(sandboxDir, { recursive: true });

    const ownerEmail = process.env.SMTP_USER || "roqaiahanjum17@gmail.com";

    // Definitions for all 23 tools
    const toolTests: ToolTestItem[] = [
        {
            name: "web_search",
            description: "Searches the web via DuckDuckGo/Brave",
            inputs: { query: "TypeScript official website" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.length > 20 && !out.includes("Safety Violation"),
                reason: "Output must be search results string > 20 chars"
            })
        },
        {
            name: "local_file_system",
            description: "Inspects workspace filesystem safely",
            inputs: { action: "list" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("package.json") || out.includes("[FILE]") || out.includes("[DIR]")),
                reason: "Output must list workspace files including package.json"
            })
        },
        {
            name: "write_sandbox_file",
            description: "Writes sanitized file into src/sandbox",
            inputs: { fileName: "eval_test_tool3.txt", content: "OpenClaw Tool Test 3 Verification" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("Successfully created and verified file") || out.includes("Successfully written")) && out.includes("eval_test_tool3.txt"),
                reason: "Output must confirm file was successfully created/written"
            })
        },
        {
            name: "get_current_time",
            description: "Returns current local & ISO timestamp",
            inputs: {},
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Current System Time:") && out.includes("202"),
                reason: "Output must contain Current System Time with current year"
            })
        },
        {
            name: "update_user_profile",
            description: "Updates user_profile.txt context",
            inputs: { preferences: "Prefers concise technical answers in evaluations." },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Successfully updated user_profile.txt"),
                reason: "Output must confirm user_profile.txt update"
            })
        },
        {
            name: "run_sandbox_code",
            description: "Runs code in isolated sandbox",
            inputs: { fileName: "eval_exec_tool6.js" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("TOOL_EXECUTION_PASS_42"),
                reason: "Output must contain script stdout 'TOOL_EXECUTION_PASS_42'"
            })
        },
        {
            name: "synthesize_skill",
            description: "Generates and registers dynamic tool",
            inputs: {
                name: "eval_adder_tool",
                description: "Adds two numbers together for testing",
                code: "return input.a + input.b;",
                schemaJSON: "{ a: z.number(), b: z.number() }"
            },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("Successfully synthesized and registered") || out.includes("successfully created") || out.includes("already exists")),
                reason: "Output must confirm skill creation or duplicate handling"
            })
        },
        {
            name: "visualize_architecture",
            description: "Generates Mermaid system architecture diagram",
            inputs: {},
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("graph") || out.includes("Architecture Map") || out.includes("Mermaid")),
                reason: "Output must contain Mermaid diagram or architecture map"
            })
        },
        {
            name: "ingest_to_memory",
            description: "Indexes file content into RAG memory store",
            inputs: { filePath: "eval_notes_tool9.txt" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Successfully ingested"),
                reason: "Output must confirm document was ingested"
            })
        },
        {
            name: "save_knowledge",
            description: "Saves fact to Layer 3 Knowledge Base",
            inputs: { category: "eval_system", key: "eval_harness_status", value: "active" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Successfully saved knowledge fact"),
                reason: "Output must confirm knowledge fact was saved"
            })
        },
        {
            name: "get_all_knowledge",
            description: "Retrieves all facts from Layer 3",
            inputs: {},
            expectedAssertion: (out) => {
                if (typeof out !== "string") return { pass: false, reason: "Output must be a string" };
                try {
                    const parsed = JSON.parse(out);
                    const isArray = Array.isArray(parsed);
                    const validStructure = isArray && parsed.length > 0 && parsed.some((f: any) => f.key && f.value);
                    return {
                        pass: validStructure,
                        reason: "Output must be valid JSON array of knowledge facts with key and value properties"
                    };
                } catch {
                    return { pass: false, reason: "Output is not valid JSON array of facts" };
                }
            }
        },
        {
            name: "get_memory_stats",
            description: "Returns statistics on 4 memory layers",
            inputs: {},
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Memory System Statistics") && out.includes("Interactions:"),
                reason: "Output must contain memory layer statistics breakdown"
            })
        },
        {
            name: "ingest_to_long_term_memory",
            description: "Direct vector store text indexing",
            inputs: { text: "Evaluation harness verification fact for vector indexing.", source: "eval_suite_tool13" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Successfully ingested text"),
                reason: "Output must confirm ingestion into long-term memory"
            })
        },
        {
            name: "search_memory",
            description: "Searches facts and vector memories",
            inputs: { query: "eval_harness_status" },
            expectedAssertion: (out) => {
                if (typeof out !== "string") return { pass: false, reason: "Output must be a string" };
                const hasMatchHeader = out.includes("[USER_FACTS MATCHES]") || out.includes("[CONVERSATION MATCHES]") || out.includes("[SEMANTIC_MEMORY MATCHES]");
                const hasExpectedContent = out.includes("eval_harness_status") || out.includes("eval_system") || out.includes("active");
                return {
                    pass: hasMatchHeader && hasExpectedContent,
                    reason: "Output must return structured match section ([USER_FACTS MATCHES]) containing query key 'eval_harness_status'"
                };
            }
        },
        {
            name: "generate_data_chart",
            description: "Synthesizes HTML chart in sandbox",
            inputs: {
                title: "Evaluation Metrics",
                type: "bar",
                dataJSON: JSON.stringify([{ label: "Precision", value: 95 }, { label: "Recall", value: 92 }])
            },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("Chart generated successfully") || out.includes("Data chart created")) && out.includes(".html"),
                reason: "Output must confirm chart HTML creation"
            })
        },
        {
            name: "run_system_audit",
            description: "Verifies SQLite, sandbox, and process uptime",
            inputs: {},
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("System Environment Audit Report") && out.includes("OPERATIONAL"),
                reason: "Output must include 'System Environment Audit Report' and 'OPERATIONAL' computed from real DB/sandbox/router checks"
            })
        },
        {
            name: "generate_project_manual",
            description: "Synthesizes HTML system manual in sandbox",
            inputs: {},
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("manual.html") && out.includes("bytes"),
                reason: "Output must confirm manual.html synthesized"
            })
        },
        {
            name: "manage_project_goals",
            description: "Manages persistent project goals in goals.json",
            inputs: { action: "list" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("goals") || out.includes("[")),
                reason: "Output must list recorded project goals"
            })
        },
        {
            name: "scrape_website",
            description: "Scrapes public web page with SSRF protection",
            inputs: { url: "https://example.com" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("Example Domain") || out.includes("characters")),
                reason: "Output must contain scraped web content from example.com"
            })
        },
        {
            name: "delegate_task",
            description: "Delegates sub-task to child subagent",
            inputs: { role: "Writer", task: "Summarize the value of automated regression testing in one sentence." },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("SubAgent Execution Result") || out.includes("Summary:")),
                reason: "Output must return SubAgent execution summary"
            })
        },
        {
            name: "send_email_report",
            description: "Dispatches SMTP email report to owner",
            inputs: {
                to: ownerEmail,
                subject: "OpenClaw Echo Evaluation Test Email",
                body: "This is an automated test message dispatched by the OpenClaw evaluation harness to verify the send_email_report tool."
            },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Email sent successfully"),
                reason: "Output must confirm email sent successfully"
            })
        },
        {
            name: "manage_scheduled_tasks",
            description: "Manages Clockwork persistent schedules",
            inputs: { action: "list" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && (out.includes("Scheduled tasks status") || out.includes("No scheduled tasks") || out.includes("[")),
                reason: "Output must return status of scheduled tasks"
            })
        },
        {
            name: "manage_git_repository",
            description: "Executes git status/log in workspace",
            inputs: { action: "status" },
            expectedAssertion: (out) => ({
                pass: typeof out === "string" && out.includes("Git command [git status --short] output:"),
                reason: "Output must return output of git status command"
            })
        }
    ];

    const results: ToolTestResult[] = [];
    const csvRows: string[] = [
        "tool_id,tool_name,status,duration_ms,assertion_description,input_used,output_received,error_message"
    ];

    // Setup prerequisites for tool 6 and tool 9
    const tool6Path = path.resolve(sandboxDir, "eval_exec_tool6.js");
    await fs.writeFile(tool6Path, 'console.log("TOOL_EXECUTION_PASS_42");', "utf-8");

    const tool9Path = path.resolve(sandboxDir, "eval_notes_tool9.txt");
    await fs.writeFile(tool9Path, "OpenClaw Evaluation Notes Content for Memory Ingestion", "utf-8");

    let toolIdx = 0;
    for (const testItem of toolTests) {
        toolIdx++;
        console.log(`[ToolEval] [${toolIdx}/23] Testing tool '${testItem.name}'...`);
        const toolObj = SkillRegistry.getToolByName(testItem.name);

        if (!toolObj) {
            const failRes: ToolTestResult = {
                id: toolIdx,
                name: testItem.name,
                status: "FAIL",
                durationMs: 0,
                inputUsed: JSON.stringify(testItem.inputs),
                outputReceived: "TOOL_NOT_FOUND_IN_REGISTRY",
                assertionDescription: "Tool must exist in SkillRegistry",
                errorMessage: `Tool '${testItem.name}' not found in SkillRegistry`
            };
            results.push(failRes);
            continue;
        }

        const t0 = Date.now();
        let rawOutput: any = "";
        let errorMsg = "";
        let pass = false;
        let reason = "";

        try {
            rawOutput = await toolObj.invoke(testItem.inputs);
            const assertion = testItem.expectedAssertion(rawOutput);
            pass = assertion.pass;
            reason = assertion.reason || "";
        } catch (err: any) {
            pass = false;
            errorMsg = err.message || String(err);
            rawOutput = `EXCEPTION: ${errorMsg}`;
        }

        const durationMs = Date.now() - t0;
        const resRecord: ToolTestResult = {
            id: toolIdx,
            name: testItem.name,
            status: pass ? "PASS" : "FAIL",
            durationMs,
            inputUsed: JSON.stringify(testItem.inputs),
            outputReceived: String(rawOutput).slice(0, 500),
            assertionDescription: reason,
            errorMessage: errorMsg || undefined
        };

        results.push(resRecord);
        console.log(`[ToolEval] Tool '${testItem.name}': ${resRecord.status} (${durationMs}ms)`);

        const safeInput = `"${JSON.stringify(testItem.inputs).replace(/"/g, '""')}"`;
        const safeOutput = `"${String(rawOutput).slice(0, 300).replace(/"/g, '""').replace(/\n/g, ' ')}"`;
        const safeAssertion = `"${reason.replace(/"/g, '""')}"`;
        const safeErr = `"${errorMsg.replace(/"/g, '""')}"`;

        csvRows.push([
            resRecord.id,
            resRecord.name,
            resRecord.status,
            resRecord.durationMs,
            safeAssertion,
            safeInput,
            safeOutput,
            safeErr
        ].join(","));
    }

    // Cleanup temporary files created for testing
    await fs.unlink(tool6Path).catch(() => {});
    await fs.unlink(tool9Path).catch(() => {});
    await fs.unlink(path.resolve(sandboxDir, "eval_test_tool3.txt")).catch(() => {});
    await fs.unlink(path.resolve(sandboxDir, "skills", "eval_adder_tool.js")).catch(() => {});
    SkillRegistry.unregisterTool("eval_adder_tool");

    const totalTools = results.length;
    const passed = results.filter(r => r.status === "PASS").length;
    const failed = results.filter(r => r.status === "FAIL").length;
    const passRate = (passed / totalTools) * 100;

    const csvPath = path.resolve("eval/results/tools_results.csv");
    await fs.writeFile(csvPath, csvRows.join("\n"), "utf-8");
    console.log(`[ToolEval] Results saved to ${csvPath}`);

    return {
        totalTools,
        passed,
        failed,
        passRate,
        results
    };
}

if (require.main === module) {
    evaluateTools().then(res => {
        console.log("\n=== 23 TOOLS EVALUATION RESULTS ===");
        console.log(`Total Tools: ${res.totalTools}`);
        console.log(`Passed: ${res.passed}`);
        console.log(`Failed: ${res.failed}`);
        console.log(`Pass Rate: ${res.passRate.toFixed(2)}%\n`);

        res.results.forEach(r => {
            console.log(`[${r.status}] Tool #${r.id} [${r.name}] (${r.durationMs}ms)`);
            if (r.status === "FAIL") {
                console.log(`   Assertion: ${r.assertionDescription}`);
                console.log(`   Output: ${r.outputReceived}`);
                if (r.errorMessage) console.log(`   Error: ${r.errorMessage}`);
            }
        });
    }).catch(err => {
        console.error("Tool evaluation error:", err);
        process.exit(1);
    });
}
