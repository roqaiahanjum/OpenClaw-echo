import * as fs from "fs/promises";
import * as path from "path";
import { ModelRouter } from "../src/core/router";
import { HumanMessage } from "@langchain/core/messages";
import Groq from "groq-sdk";

export type FaultType = "invalid_key" | "network_failure" | "timeout" | "rate_limit";

export interface FailoverInjectionResult {
    id: number;
    faultType: FaultType;
    targetProvider: string;
    injectedFaultDescription: string;
    isMock: boolean;
    isRealProviderFailure: boolean;
    result: "RECOVERED" | "FAILED" | "NOT MEASURED";
    durationMs: number;
    fallbackProvider?: string;
    verbatimError?: string;
}

export interface PerModeTimingStats {
    mean: number;
    median: number;
    p95: number;
}

export interface PerModeResult {
    total: number;
    recovered: number;
    failed: number;
    notMeasured: number;
    recoveryRate: number;
    timing: PerModeTimingStats;
    ci95Lower: number;
    ci95Upper: number;
}

export interface FailoverEvaluationSummary {
    totalInjections: number;
    recoveredCount: number;
    failedCount: number;
    notMeasuredCount: number;
    recoveryRate: number;
    ci95Lower: number;
    ci95Upper: number;
    faultBreakdown: Record<FaultType, PerModeResult>;
    failedCases: FailoverInjectionResult[];
    auditFinding: string;
    methodsDescription: Record<FaultType, {
        mechanism: string;
        isRealProviderFailure: boolean;
        injectionMethod: string;
    }>;
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function calcTimingStats(values: number[]): PerModeTimingStats {
    if (values.length === 0) return { mean: 0, median: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    const p95Idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return { mean, median, p95: sorted[p95Idx] };
}

/**
 * Wilson score 95% confidence interval for a proportion.
 * n: number of trials, k: successes
 */
function wilsonCI95(k: number, n: number): { lower: number; upper: number } {
    if (n === 0) return { lower: 0, upper: 1 };
    const z = 1.96;
    const p = k / n;
    const denom = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return {
        lower: Math.max(0, (centre - margin) / denom),
        upper: Math.min(1, (centre + margin) / denom)
    };
}

/**
 * FAULT INJECTION METHODS TABLE
 * ─────────────────────────────
 * Mode 1 — invalid_key:
 *   Mechanism: Swap router.groqClient with a new Groq SDK instance using the
 *   literal key "gsk_invalid_test_key_failover_scale_99999". Groq's API
 *   returns HTTP 401 Unauthorized. This is a REAL provider failure — the
 *   network call reaches Groq and gets rejected.
 *
 * Mode 2 — network_failure:
 *   Mechanism: Swap router.groqClient to point its baseURL at
 *   http://127.0.0.1:59999/v1 (no server listening). Node.js throws
 *   ECONNREFUSED before TLS/HTTP even begins. REAL network failure.
 *
 * Mode 3 — timeout:
 *   Mechanism: Pass options.primaryTimeoutMs = 150ms to router.invoke().
 *   Inside invokeProvider(), a local AbortController fires after 150ms and
 *   throws ProviderTimeoutError. The request IS sent to Groq but the local
 *   timer aborts waiting for the response. REAL per-provider timeout with
 *   REAL upstream network round-trip (partial).
 *
 * Mode 4 — rate_limit:
 *   Mechanism: Set router.groqCallsThisMinute = 999 before each call.
 *   The router's checkGroqRateLimit() method detects RPM exhaustion and
 *   skips Groq entirely — falling directly to Gemini. This is SIMULATED
 *   (no upstream 429 is triggered) to avoid locking out the live bot.
 *   The actual Groq upstream rate-limit response path is not exercised.
 */
export const FAILOVER_METHODS: FailoverEvaluationSummary["methodsDescription"] = {
    invalid_key: {
        mechanism: "Swap router.groqClient with Groq SDK using invalid API key string",
        isRealProviderFailure: true,
        injectionMethod: "(router as any).groqClient = new Groq({ apiKey: 'gsk_invalid...' }) → real HTTP 401 from Groq"
    },
    network_failure: {
        mechanism: "Redirect Groq client baseURL to localhost:59999 (no listener)",
        isRealProviderFailure: true,
        injectionMethod: "new Groq({ baseURL: 'http://127.0.0.1:59999/v1' }) → ECONNREFUSED before HTTP"
    },
    timeout: {
        mechanism: "Set options.primaryTimeoutMs=150ms; internal provider AbortController fires",
        isRealProviderFailure: true,
        injectionMethod: "router.invoke(msgs, undefined, { primaryTimeoutMs: 150 }) → ProviderTimeoutError thrown inside invokeProvider()"
    },
    rate_limit: {
        mechanism: "Set router.groqCallsThisMinute=999 to trip internal RPM guard",
        isRealProviderFailure: false,
        injectionMethod: "(router as any).groqCallsThisMinute = 999 → router.checkGroqRateLimit() skips Groq, falls directly to Gemini (SIMULATED — no upstream 429)"
    }
};

export async function evaluateFailover(): Promise<FailoverEvaluationSummary> {
    console.log("=== STARTING SCALED AUTHENTIC FAILOVER EVALUATION (20 per mode, Paced) ===");

    const router = ModelRouter.getInstance();
    const originalGroqClient = (router as any).groqClient;
    const realGroqKey = process.env.GROQ_API_KEY || "";

    const results: FailoverInjectionResult[] = [];
    const csvRows: string[] = [
        "injection_id,fault_type,target_provider,is_mock,is_real_provider_failure,result,fallback_provider,duration_ms,verbatim_error"
    ];

    let injectionId = 0;
    // 20 injections per mode = 80 total.
    // Pace: 4200ms between calls → stays under Gemini free-tier 15 RPM.
    // 80 × 4.2s = 336s total wall-clock (~5.6 minutes).
    const RUNS_PER_MODE = 20;

    const runLiveTest = async (
        faultType: FaultType,
        description: string,
        isRealProviderFailure: boolean,
        setup: () => { cleanup: () => void; options?: any }
    ): Promise<FailoverInjectionResult> => {
        injectionId++;
        const t0 = Date.now();
        router.resetCircuitBreaker();
        const { cleanup, options } = setup();

        let status: "RECOVERED" | "FAILED" = "FAILED";
        let fallbackUsed = "None";
        let verbatimError = "";

        try {
            const response = await router.invoke(
                [new HumanMessage("Health probe message for failover verification")],
                undefined,
                options
            );
            if (response && response.content) {
                status = "RECOVERED";
                fallbackUsed = "Gemini Flash (Live Fallback)";
            }
        } catch (err: any) {
            status = "FAILED";
            verbatimError = err.message || String(err);
        } finally {
            cleanup();
            router.resetCircuitBreaker();
        }

        const durationMs = Date.now() - t0;
        const record: FailoverInjectionResult = {
            id: injectionId,
            faultType,
            targetProvider: "groq-fast (Primary)",
            injectedFaultDescription: description,
            isMock: !isRealProviderFailure,
            isRealProviderFailure,
            result: status,
            durationMs,
            fallbackProvider: fallbackUsed,
            verbatimError: verbatimError || undefined
        };

        results.push(record);
        console.log(`  [Case #${injectionId}] [${faultType}] Result: ${status} in ${durationMs}ms | Fallback: ${fallbackUsed} | Err: ${(verbatimError || "None").slice(0, 80)}`);

        const safeVerbatim = `"${verbatimError.replace(/"/g, '""')}"`;
        csvRows.push([
            record.id,
            record.faultType,
            `"${record.targetProvider}"`,
            record.isMock,
            record.isRealProviderFailure,
            record.result,
            `"${record.fallbackProvider}"`,
            record.durationMs,
            safeVerbatim
        ].join(","));

        // Pace at 4200ms to stay under Gemini's 15 RPM free-tier (15 req/60s = 4s minimum)
        await sleep(4200);
        return record;
    };

    // Mode 1: Real Invalid API Key (N=20)
    console.log(`\n>>> Mode 1/4: Invalid API Key on Groq Fast (N=${RUNS_PER_MODE} live calls)...`);
    for (let i = 1; i <= RUNS_PER_MODE; i++) {
        await runLiveTest("invalid_key", `Live Groq 401 Unauthorized (${i}/${RUNS_PER_MODE})`, true, () => {
            (router as any).groqClient = new Groq({ apiKey: "gsk_invalid_test_key_failover_scale_99999" });
            return {
                cleanup: () => {
                    (router as any).groqClient = new Groq({ apiKey: realGroqKey });
                }
            };
        });
    }

    // Mode 2: Real Network Failure / ECONNREFUSED (N=20)
    console.log(`\n>>> Mode 2/4: Network Failure / Connection Refused on Groq Fast (N=${RUNS_PER_MODE} live calls)...`);
    for (let i = 1; i <= RUNS_PER_MODE; i++) {
        await runLiveTest("network_failure", `Live ECONNREFUSED on Groq Fast (${i}/${RUNS_PER_MODE})`, true, () => {
            (router as any).groqClient = new Groq({
                apiKey: realGroqKey,
                baseURL: "http://127.0.0.1:59999/v1"
            });
            return {
                cleanup: () => {
                    (router as any).groqClient = new Groq({ apiKey: realGroqKey });
                }
            };
        });
    }

    // Mode 3: Real Tiny Per-Provider Timeout 150ms (N=20)
    console.log(`\n>>> Mode 3/4: Tiny Per-Provider Timeout on Groq Fast (N=${RUNS_PER_MODE} live calls)...`);
    for (let i = 1; i <= RUNS_PER_MODE; i++) {
        await runLiveTest("timeout", `Live 150ms Per-Provider Timeout on Groq Fast (${i}/${RUNS_PER_MODE})`, true, () => {
            return {
                options: { primaryTimeoutMs: 150 },
                cleanup: () => {}
            };
        });
    }

    // Mode 4: Simulated Rate-Limit (N=20)
    // Note: triggering a live upstream 429 would lock out the active Telegram bot.
    // We simulate the internal RPM circuit-breaker path (sets groqCallsThisMinute=999).
    // Explicitly marked isMock=true / isRealProviderFailure=false in the record.
    console.log(`\n>>> Mode 4/4: Rate Limit Handling (RPM Circuit Breaker) (N=${RUNS_PER_MODE})...`);
    for (let i = 1; i <= RUNS_PER_MODE; i++) {
        await runLiveTest("rate_limit", `Simulated Groq RPM Exhaustion (${i}/${RUNS_PER_MODE})`, false, () => {
            (router as any).groqCallsThisMinute = 999;
            return {
                cleanup: () => {
                    (router as any).groqCallsThisMinute = 0;
                }
            };
        });
    }

    // Restore clean state
    (router as any).groqClient = originalGroqClient || new Groq({ apiKey: realGroqKey });
    router.resetCircuitBreaker();

    // ── Statistics ───────────────────────────────────────────────────────────
    const totalInjections = results.length;
    const recoveredCount = results.filter(r => r.result === "RECOVERED").length;
    const failedCount = results.filter(r => r.result === "FAILED").length;
    const notMeasuredCount = results.filter(r => r.result === "NOT MEASURED").length;
    const measuredCount = totalInjections - notMeasuredCount;
    const recoveryRate = measuredCount > 0 ? (recoveredCount / measuredCount) * 100 : 0;
    const failedCases = results.filter(r => r.result === "FAILED");

    const { lower: globalCiLower, upper: globalCiUpper } = wilsonCI95(recoveredCount, measuredCount);

    const faultBreakdown = {} as Record<FaultType, PerModeResult>;
    for (const ft of ["invalid_key", "network_failure", "timeout", "rate_limit"] as FaultType[]) {
        const modeResults = results.filter(r => r.faultType === ft);
        const mTotal = modeResults.length;
        const mRecovered = modeResults.filter(r => r.result === "RECOVERED").length;
        const mFailed = modeResults.filter(r => r.result === "FAILED").length;
        const mNotMeasured = modeResults.filter(r => r.result === "NOT MEASURED").length;
        const mMeasured = mTotal - mNotMeasured;
        const mRate = mMeasured > 0 ? (mRecovered / mMeasured) * 100 : 0;
        const durations = modeResults.filter(r => r.result === "RECOVERED").map(r => r.durationMs);
        const timing = calcTimingStats(durations);
        const ci = wilsonCI95(mRecovered, mMeasured);
        faultBreakdown[ft] = {
            total: mTotal,
            recovered: mRecovered,
            failed: mFailed,
            notMeasured: mNotMeasured,
            recoveryRate: mRate,
            timing,
            ci95Lower: ci.lower * 100,
            ci95Upper: ci.upper * 100
        };
    }

    const csvPath = path.resolve("eval/results/failover_results.csv");
    await fs.writeFile(csvPath, csvRows.join("\n"), "utf-8");
    console.log(`\n[FailoverEval] Scaled authentic results saved to ${csvPath}`);

    return {
        totalInjections,
        recoveredCount,
        failedCount,
        notMeasuredCount,
        recoveryRate,
        ci95Lower: globalCiLower * 100,
        ci95Upper: globalCiUpper * 100,
        faultBreakdown,
        failedCases,
        auditFinding: `Authentic scaled evaluation: ${totalInjections} injections (${RUNS_PER_MODE} per mode × 4 fault modes). Recovery rate: ${recoveryRate.toFixed(2)}% [95% CI: ${(globalCiLower * 100).toFixed(1)}%–${(globalCiUpper * 100).toFixed(1)}%]. Three modes are real provider failures; rate_limit is simulated (internal RPM guard).`,
        methodsDescription: FAILOVER_METHODS
    };
}

if (require.main === module) {
    evaluateFailover().then(res => {
        console.log("\n=== SCALED AUTHENTIC FAILOVER RESULTS ===");
        console.log(`Total Injections (N): ${res.totalInjections}`);
        console.log(`Recovered: ${res.recoveredCount} (${res.recoveryRate.toFixed(2)}%) [95% CI: ${res.ci95Lower.toFixed(1)}%–${res.ci95Upper.toFixed(1)}%]`);
        console.log(`Failed: ${res.failedCount}`);
        console.log(`Not Measured: ${res.notMeasuredCount}`);
        console.log("\nBreakdown by Fault Type (Recovered timing is only RECOVERED cases):");
        for (const [ft, stats] of Object.entries(res.faultBreakdown)) {
            console.log(`  [${ft}] Recovered=${stats.recovered}/${stats.total} (${stats.recoveryRate.toFixed(1)}%) | CI95: [${stats.ci95Lower.toFixed(1)}%–${stats.ci95Upper.toFixed(1)}%] | Failover Time: Mean=${stats.timing.mean}ms Median=${stats.timing.median}ms P95=${stats.timing.p95}ms`);
        }
        console.log("\nMethods Table:");
        for (const [ft, m] of Object.entries(res.methodsDescription)) {
            console.log(`  [${ft}] REAL=${m.isRealProviderFailure} | ${m.mechanism}`);
        }
        if (res.failedCases.length > 0) {
            console.log("\nVerbatim Errors:");
            res.failedCases.forEach(fc => {
                console.log(`  [Case #${fc.id}] Fault: ${fc.faultType} | Error: ${fc.verbatimError}`);
            });
        }
    }).catch(err => {
        console.error("Failover evaluation error:", err);
        process.exit(1);
    });
}
