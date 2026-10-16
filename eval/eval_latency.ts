import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { executeAutonomousFlow } from "../src/integrations/telegram";
import { ModelRouter } from "../src/core/router";
import { MemoryManager } from "../src/memory/manager";
import { SkillRegistry } from "../src/skills/registry";
import * as plannerModule from "../src/core/planner";
import * as verifierModule from "../src/core/verifier";
import * as localVerifierModule from "../src/core/localVerifier";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface LatencyRunRecord {
    id: number;
    pathType: "fast-path" | "tool-path";
    prompt: string;
    totalLatencyMs: number;
    llmCallCount: number;
    memoryRetrievalMs: number;
    plannerMs: number;
    toolExecutionMs: number;
    verifierMs: number;
    synthesisMs: number;
    responsePreview: string;
}

export interface MetricSummary {
    mean: number;
    median: number;
    p95: number;
}

export interface LatencyEvaluationSummary {
    totalRuns: number;
    fastPathRuns: number;
    toolPathRuns: number;
    fastPathLatency: MetricSummary;
    toolPathLatency: MetricSummary;
    overallLatency: MetricSummary;
    fastPathLlmCalls: MetricSummary;
    toolPathLlmCalls: MetricSummary;
    stageMetrics: {
        memoryRetrieval: MetricSummary;
        planner: MetricSummary;
        toolExecution: MetricSummary;
        verifier: MetricSummary;
        synthesis: MetricSummary;
    };
    records: LatencyRunRecord[];
    promptsUsed: {
        fastPath: string[];
        toolPath: string[];
    };
}

function calculatePercentiles(values: number[]): MetricSummary {
    if (values.length === 0) return { mean: 0, median: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    const p95 = sorted[p95Index];
    return {
        mean: Math.round(mean * 100) / 100,
        median: Math.round(median * 100) / 100,
        p95: Math.round(p95 * 100) / 100
    };
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export const FAST_PATH_PROMPTS = [
    "hi",
    "hello there",
    "hey",
    "good morning",
    "how are you today?",
    "who are you?",
    "what is your name?",
    "tell me a joke",
    "thank you very much",
    "goodbye",
    "nice to meet you",
    "what can you do?",
    "are you an ai assistant?",
    "2+2",
    "what is 15 * 4?",
    "calculate 100 / 5",
    "50 - 25",
    "what is 7 * 8?",
    "what is 10 + 20?",
    "calculate 9 * 9"
];

export const TOOL_PATH_PROMPTS = [
    "manage project goals list",
    "get current time",
    "run system audit",
    "visualize architecture",
    "get memory stats",
    "get all knowledge",
    "list files in workspace",
    "check git status",
    "search memory for database",
    "list all scheduled tasks",
    "what are my goals?",
    "show git branch",
    "inspect local file system",
    "read user profile",
    "check current active milestones",
    "view memory statistics",
    "review project goals",
    "show git log",
    "search memory for preferences",
    "system audit check"
];

export async function evaluateLatency(): Promise<LatencyEvaluationSummary> {
    console.log("=== STARTING TRUE END-TO-END LATENCY BENCHMARK (via executeAutonomousFlow) ===");

    const memory = MemoryManager.getInstance();
    await memory.initialize();

    const router = ModelRouter.getInstance();

    // Preserve originals
    const origGetContext = (memory as any).getContext.bind(memory);
    const origInvoke = router.invoke.bind(router);
    const origGenerateSmartPlan = plannerModule.generateSmartPlan;
    const origLocalVerify = localVerifierModule.localVerifyToolResult;
    const origVerifyStepResult = verifierModule.verifyStepResult;
    const origGetToolByName = SkillRegistry.getToolByName.bind(SkillRegistry);

    const records: LatencyRunRecord[] = [];
    const csvRows: string[] = [
        "id,path_type,prompt,total_latency_ms,llm_call_count,memory_ms,planner_ms,tool_ms,verifier_ms,synthesis_ms,response_preview"
    ];

    let runId = 0;

    const runFlow = async (prompt: string, pathType: "fast-path" | "tool-path") => {
        runId++;
        let llmCalls = 0;
        let memoryMs = 0;
        let plannerMs = 0;
        let toolMs = 0;
        let verifierMs = 0;
        let llmTimeTotal = 0;

        // Instrumentation hooks
        (memory as any).getContext = async (...args: any[]) => {
            const t0 = Date.now();
            try {
                return await origGetContext(...args);
            } finally {
                memoryMs += (Date.now() - t0);
            }
        };

        (plannerModule as any).generateSmartPlan = async (...args: any[]) => {
            const t0 = Date.now();
            try {
                return await (origGenerateSmartPlan as any)(...args);
            } finally {
                plannerMs += (Date.now() - t0);
            }
        };

        (SkillRegistry as any).getToolByName = (name: string) => {
            const tool = origGetToolByName(name);
            if (!tool) return tool;
            return {
                ...tool,
                invoke: async (...args: any[]) => {
                    const t0 = Date.now();
                    try {
                        return await tool.invoke(...args);
                    } finally {
                        toolMs += (Date.now() - t0);
                    }
                }
            };
        };

        (localVerifierModule as any).localVerifyToolResult = (...args: any[]) => {
            const t0 = Date.now();
            try {
                return (origLocalVerify as any)(...args);
            } finally {
                verifierMs += (Date.now() - t0);
            }
        };

        (verifierModule as any).verifyStepResult = async (...args: any[]) => {
            const t0 = Date.now();
            try {
                return await (origVerifyStepResult as any)(...args);
            } finally {
                verifierMs += (Date.now() - t0);
            }
        };

        router.invoke = async (...args: any[]) => {
            llmCalls++;
            const t0 = Date.now();
            try {
                return await origInvoke(...args);
            } finally {
                llmTimeTotal += (Date.now() - t0);
            }
        };

        let responseText = "";
        const replyFn = async (text: string) => {
            responseText = text;
        };

        const tStart = Date.now();
        try {
            await executeAutonomousFlow(prompt, `eval_latency_${runId}`, false, replyFn);
        } catch (err: any) {
            responseText = `EXCEPTION: ${err.message}`;
        }
        const totalDurationMs = Date.now() - tStart;

        // Stage breakdown calculation:
        // Synthesis / Agent reasoning is the LLM time spent generating response (or remainder after explicit stages)
        const nonLlmStageTime = memoryMs + toolMs + verifierMs;
        const synthesisMs = Math.max(0, totalDurationMs - nonLlmStageTime - plannerMs);

        const record: LatencyRunRecord = {
            id: runId,
            pathType,
            prompt,
            totalLatencyMs: totalDurationMs,
            llmCallCount: llmCalls,
            memoryRetrievalMs: memoryMs,
            plannerMs,
            toolExecutionMs: toolMs,
            verifierMs,
            synthesisMs,
            responsePreview: responseText.slice(0, 100).replace(/\n/g, " ")
        };

        records.push(record);
        console.log(`  [${pathType} #${runId}] Total: ${totalDurationMs}ms (LLM Calls: ${llmCalls}) | Mem: ${memoryMs}ms | Plan: ${plannerMs}ms | Tool: ${toolMs}ms | Verif: ${verifierMs}ms | Synth: ${synthesisMs}ms | Prompt: "${prompt}"`);

        const safePrompt = `"${prompt.replace(/"/g, '""')}"`;
        const safeResp = `"${record.responsePreview.replace(/"/g, '""')}"`;
        csvRows.push([
            record.id,
            record.pathType,
            safePrompt,
            record.totalLatencyMs,
            record.llmCallCount,
            record.memoryRetrievalMs,
            record.plannerMs,
            record.toolExecutionMs,
            record.verifierMs,
            record.synthesisMs,
            safeResp
        ].join(","));

        // Pace at 2200ms to stay safely under Groq's 30 RPM limit (30 calls / 60s)
        await sleep(2200);
    };

    try {
        // 1. FAST-PATH (20 Prompts)
        console.log(`\n[LatencyEval] Executing ${FAST_PATH_PROMPTS.length} Fast-Path runs through executeAutonomousFlow...`);
        for (const prompt of FAST_PATH_PROMPTS) {
            await runFlow(prompt, "fast-path");
        }

        // 2. TOOL-PATH (20 Prompts)
        console.log(`\n[LatencyEval] Executing ${TOOL_PATH_PROMPTS.length} Tool-Path runs through executeAutonomousFlow...`);
        for (const prompt of TOOL_PATH_PROMPTS) {
            await runFlow(prompt, "tool-path");
        }
    } finally {
        // Restore all originals
        (memory as any).getContext = origGetContext;
        (plannerModule as any).generateSmartPlan = origGenerateSmartPlan;
        (SkillRegistry as any).getToolByName = origGetToolByName;
        (localVerifierModule as any).localVerifyToolResult = origLocalVerify;
        (verifierModule as any).verifyStepResult = origVerifyStepResult;
        router.invoke = origInvoke;
    }

    // Save CSV
    const csvPath = path.resolve("eval/results/latency_results.csv");
    await fs.writeFile(csvPath, csvRows.join("\n"), "utf-8");
    console.log(`\n[LatencyEval] End-to-end latency records saved to ${csvPath}`);

    // Percentile statistics
    const fastRecords = records.filter(r => r.pathType === "fast-path");
    const toolRecords = records.filter(r => r.pathType === "tool-path");

    const fastPathLatency = calculatePercentiles(fastRecords.map(r => r.totalLatencyMs));
    const toolPathLatency = calculatePercentiles(toolRecords.map(r => r.totalLatencyMs));
    const overallLatency = calculatePercentiles(records.map(r => r.totalLatencyMs));

    const fastPathLlmCalls = calculatePercentiles(fastRecords.map(r => r.llmCallCount));
    const toolPathLlmCalls = calculatePercentiles(toolRecords.map(r => r.llmCallCount));

    const stageMetrics = {
        memoryRetrieval: calculatePercentiles(records.map(r => r.memoryRetrievalMs)),
        planner: calculatePercentiles(records.map(r => r.plannerMs)),
        toolExecution: calculatePercentiles(records.map(r => r.toolExecutionMs)),
        verifier: calculatePercentiles(records.map(r => r.verifierMs)),
        synthesis: calculatePercentiles(records.map(r => r.synthesisMs))
    };

    return {
        totalRuns: records.length,
        fastPathRuns: fastRecords.length,
        toolPathRuns: toolRecords.length,
        fastPathLatency,
        toolPathLatency,
        overallLatency,
        fastPathLlmCalls,
        toolPathLlmCalls,
        stageMetrics,
        records,
        promptsUsed: {
            fastPath: FAST_PATH_PROMPTS,
            toolPath: TOOL_PATH_PROMPTS
        }
    };
}

if (require.main === module) {
    evaluateLatency().then(res => {
        console.log("\n=== TRUE END-TO-END LATENCY RESULTS ===");
        console.log(`Total Runs: ${res.totalRuns} (Fast-path: ${res.fastPathRuns}, Tool-path: ${res.toolPathRuns})`);
        console.log("\nFast-Path Latency (ms):");
        console.log(`  - Mean:   ${res.fastPathLatency.mean} ms`);
        console.log(`  - Median: ${res.fastPathLatency.median} ms`);
        console.log(`  - P95:    ${res.fastPathLatency.p95} ms`);
        console.log(`  - LLM Calls: Mean=${res.fastPathLlmCalls.mean}, Median=${res.fastPathLlmCalls.median}, P95=${res.fastPathLlmCalls.p95}`);

        console.log("\nTool-Path Latency (ms):");
        console.log(`  - Mean:   ${res.toolPathLatency.mean} ms`);
        console.log(`  - Median: ${res.toolPathLatency.median} ms`);
        console.log(`  - P95:    ${res.toolPathLatency.p95} ms`);
        console.log(`  - LLM Calls: Mean=${res.toolPathLlmCalls.mean}, Median=${res.toolPathLlmCalls.median}, P95=${res.toolPathLlmCalls.p95}`);

        console.log("\nPer-Stage Time Across All Runs (ms):");
        console.log(`  - Memory Retrieval: Mean=${res.stageMetrics.memoryRetrieval.mean} ms, Median=${res.stageMetrics.memoryRetrieval.median} ms, P95=${res.stageMetrics.memoryRetrieval.p95} ms`);
        console.log(`  - Planner:          Mean=${res.stageMetrics.planner.mean} ms, Median=${res.stageMetrics.planner.median} ms, P95=${res.stageMetrics.planner.p95} ms`);
        console.log(`  - Tool Execution:   Mean=${res.stageMetrics.toolExecution.mean} ms, Median=${res.stageMetrics.toolExecution.median} ms, P95=${res.stageMetrics.toolExecution.p95} ms`);
        console.log(`  - Verifier:         Mean=${res.stageMetrics.verifier.mean} ms, Median=${res.stageMetrics.verifier.median} ms, P95=${res.stageMetrics.verifier.p95} ms`);
        console.log(`  - Synthesis / LLM:  Mean=${res.stageMetrics.synthesis.mean} ms, Median=${res.stageMetrics.synthesis.median} ms, P95=${res.stageMetrics.synthesis.p95} ms`);
    }).catch(err => {
        console.error("Latency evaluation error:", err);
        process.exit(1);
    });
}
