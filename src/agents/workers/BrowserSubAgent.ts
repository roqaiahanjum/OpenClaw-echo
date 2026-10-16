// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { isSafePublicUrl } from "../../skills/tools";

export class BrowserSubAgent implements WorkerAgent {
    public readonly agentType = "browser" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[BrowserSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        try {
            // 1. Resolve Target URL
            let targetUrl = task.contextPayload?.url;

            if (!targetUrl) {
                const urlMatch = task.taskDescription.match(/https?:\/\/[^\s"'<>)]+/i);
                if (urlMatch) {
                    targetUrl = urlMatch[0];
                }
            }

            if (!targetUrl && task.contextPayload?.prerequisiteFindings) {
                const prereqUrlMatch = task.contextPayload.prerequisiteFindings.match(/https?:\/\/[^\s"'<>)]+/i);
                if (prereqUrlMatch) {
                    targetUrl = prereqUrlMatch[0];
                }
            }

            if (!targetUrl) {
                const lower = (task.taskDescription + " " + (task.contextPayload?.originalPrompt || "")).toLowerCase();
                if (lower.includes("typescript")) {
                    targetUrl = "https://www.typescriptlang.org/docs/";
                } else if (lower.includes("python")) {
                    targetUrl = "https://docs.python.org/3/";
                } else if (lower.includes("node")) {
                    targetUrl = "https://nodejs.org/en/docs";
                }
            }

            if (!targetUrl) {
                const executionTimeMs = Date.now() - startTime;
                console.warn(`[StructuredLog] [TaskId:${task.taskId}] [Agent:BrowserSubAgent] [Tool:scrape_website] [Status:FAILED] [DurationMs:0] [Result:Missing URL]`);
                return {
                    taskId: task.taskId,
                    targetAgent: this.agentType,
                    status: "FAILED",
                    resultData: "",
                    error: "No valid public URL found in task description, prerequisite findings, or context payload.",
                    executionTimeMs
                };
            }

            // 2. SSRF Safety Check
            const safety = isSafePublicUrl(targetUrl);
            if (!safety.safe) {
                const executionTimeMs = Date.now() - startTime;
                console.warn(`[StructuredLog] [TaskId:${task.taskId}] [Agent:BrowserSubAgent] [Tool:scrape_website] [Status:FAILED] [DurationMs:0] [Result:Blocked - ${safety.reason}]`);
                return {
                    taskId: task.taskId,
                    targetAgent: this.agentType,
                    status: "FAILED",
                    resultData: "",
                    error: `Safety Violation: Access to ${targetUrl} blocked (${safety.reason})`,
                    executionTimeMs
                };
            }

            // 3. Invoke Real Registered Tool: scrape_website
            const scrapeTool = SkillRegistry.getToolByName("scrape_website");
            let scrapeOutput = "";
            let toolSuccess = false;
            const toolStart = Date.now();

            if (scrapeTool) {
                try {
                    scrapeOutput = String(await scrapeTool.invoke({ url: targetUrl }));
                    toolSuccess = !scrapeOutput.startsWith("Safety Error") && 
                                  !scrapeOutput.startsWith("Failed to scrape") && 
                                  scrapeOutput.length > 50;
                } catch (e: any) {
                    scrapeOutput = `Scrape tool error: ${e.message}`;
                    toolSuccess = false;
                }
            } else {
                scrapeOutput = "scrape_website tool is not registered in SkillRegistry.";
                toolSuccess = false;
            }

            const toolDuration = Date.now() - toolStart;
            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:BrowserSubAgent] [Tool:scrape_website] [Status:${toolSuccess ? 'SUCCESS' : 'FAILED'}] [DurationMs:${toolDuration}] [Result:Extracted ${scrapeOutput.length} chars from ${targetUrl}]`);

            // 4. Synthesize Documentation Highlights with LLM
            let synthesis = "";
            const router = ModelRouter.getInstance();
            if (!router.isInFallbackMode() && toolSuccess) {
                try {
                    const prompt = `You are BrowserSubAgent. Analyze and extract the key documentation principles from "${targetUrl}" for the query: "${task.taskDescription}".
Raw Scraped Documentation Text:
${scrapeOutput.slice(0, 2500)}

Summarize the core concepts, syntax patterns, or architectural best practices in 3-4 structured bullet points.`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('BROWSER_TIMEOUT')), 25000)
                    );

                    const response: any = await Promise.race([
                        router.invoke([
                            new SystemMessage("You are a specialized browser intelligence subagent."),
                            new HumanMessage(prompt)
                        ], "browser_subagent"),
                        timeoutPromise
                    ]);
                    synthesis = (response.content as string) || scrapeOutput;
                } catch (e: any) {
                    synthesis = scrapeOutput;
                }
            } else {
                synthesis = scrapeOutput || `Browsed ${targetUrl} successfully.`;
            }

            const executionTimeMs = Date.now() - startTime;
            const resultData = toolSuccess ? 
`### Official Documentation Insights
🌐 **Source URL**: ${targetUrl}

📖 **Observed Page Content**:
${synthesis.trim()}`
: `⚠️ [BrowserSubAgent Partial - Failed retrieving ${targetUrl}]: ${scrapeOutput}`;

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: toolSuccess ? "SUCCESS" : "FAILED",
                resultData,
                error: toolSuccess ? undefined : scrapeOutput,
                executionTimeMs
            };

        } catch (err: any) {
            const executionTimeMs = Date.now() - startTime;
            console.error(`[StructuredLog] [TaskId:${task.taskId}] [Agent:BrowserSubAgent] [Tool:scrape_website] [Status:FAILED] [DurationMs:${executionTimeMs}] [Result:Error ${err.message}]`);
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                resultData: "",
                error: err.message || "BrowserSubAgent failed",
                executionTimeMs
            };
        }
    }
}
