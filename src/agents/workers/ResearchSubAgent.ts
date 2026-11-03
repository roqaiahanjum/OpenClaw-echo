// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { KnowledgeGraphManager } from "../../memory/KnowledgeGraphManager";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolExecutionContract } from "../../core/toolExecutionContract";

export class ResearchSubAgent implements WorkerAgent {
    public readonly agentType = "research" as const;

    public async execute(task: ACPTask): Promise<ACPResult> {
        const startTime = Date.now();
        console.log(`[ResearchSubAgent] Executing task ${task.taskId}: "${task.taskDescription}"`);

        try {
            let webResults = "";
            let toolSuccess = false;
            const toolStart = Date.now();

            let searchQuery = task.taskDescription;
            const qMatch = task.taskDescription.match(/(?:search(?:\s+the\s+(?:web|internet)|online)?(?:\s+for)?|research(?:\s+into|\s+on|\s+about|\s+the)?|look\s+up|find\s+information\s+(?:on|about)?)\s+([^,.;\n]+?)(?:\s+(?:and\s+provide|and\s+tell|and\s+give|and\s+include|do\s+not|please\s+|with\s+sources|citing)|\.|$)/i);
            if (qMatch && qMatch[1] && qMatch[1].trim().length > 3) {
                searchQuery = qMatch[1].trim();
            }

            const webSearchTool = SkillRegistry.getToolByName("web_search");
            let isErrorSnippet = false;
            if (webSearchTool) {
                try {
                    webResults = String(await webSearchTool.invoke({ query: searchQuery }));
                    isErrorSnippet = webResults.includes("Warning: TAVILY_API_KEY") || 
                                     webResults.includes("Web search error:") || 
                                     webResults.includes("is not configured") ||
                                     webResults.includes("Web search service returned status ") ||
                                     webResults.includes("Web search timed out");
                    toolSuccess = !isErrorSnippet && !webResults.toLowerCase().includes("fatal") && webResults.length > 50;
                } catch (e: any) {
                    webResults = `Web search error: ${e.message}`;
                    isErrorSnippet = true;
                    toolSuccess = false;
                }
            } else {
                webResults = "web_search tool is not registered in registry.";
                isErrorSnippet = true;
                toolSuccess = false;
            }

            const toolDuration = Date.now() - toolStart;
            console.log(`[StructuredLog] [TaskId:${task.taskId}] [Agent:ResearchSubAgent] [Tool:web_search] [Status:${toolSuccess ? 'SUCCESS' : 'FAILED'}] [DurationMs:${toolDuration}] [Result:Extracted ${webResults.length} chars]`);

            let graphResults = "";
            try {
                const seedKeywords = Array.from(new Set(
                    task.taskDescription
                        .replace(/[^a-zA-Z0-9\s]/g, "")
                        .split(/\s+/)
                        .filter(w => w.length > 3)
                        .concat(["User"])
                ));
                const traversal = await KnowledgeGraphManager.getInstance().traverseSubGraph(seedKeywords, 2);
                graphResults = KnowledgeGraphManager.getInstance().formatGraphContextForLLM(traversal);
            } catch (e: any) {
                graphResults = "";
            }

            let synthesis = "";
            const router = ModelRouter.getInstance();
            if (!router.isInFallbackMode() && toolSuccess) {
                try {
                    const prompt = `You are ResearchSubAgent. Synthesize the factual findings for the research query: "${searchQuery}".

Verified Web Search Results:
${webResults}

Knowledge Graph Context:
${graphResults}

STRICT REQUIREMENTS:
1. Provide a clear, structured research summary answering the user's request.
2. Ground your answer strictly in the Verified Web Search Results above.
3. Include the exact source URLs and citations from the Web Search Results (e.g. [Title](URL)).
4. DO NOT invent or hallucinate citations, URLs, dates, or names not present in the search results.
5. If the search results do not contain a specific requested detail, explicitly state that it was not found in the search results rather than fabricating an answer.`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('RESEARCH_TIMEOUT')), 25000)
                    );

                    const response: any = await Promise.race([
                        router.invoke([
                            new SystemMessage("You are a specialized research agent."),
                            new HumanMessage(prompt)
                        ], "research_subagent"),
                        timeoutPromise
                    ]);
                    synthesis = (response.content as string) || webResults;
                } catch (e: any) {
                    synthesis = webResults;
                }
            } else {
                synthesis = webResults || "Research completed with basic search results.";
            }

            const executionTimeMs = Date.now() - startTime;
            ToolExecutionContract.logExecution({
                requestId: task.taskId,
                selectedAgent: this.agentType,
                selectedTool: "web_search",
                executionStatus: toolSuccess ? "SUCCESS" : "FAILED",
                durationMs: executionTimeMs,
                errorCategory: toolSuccess ? "NONE" : ToolExecutionContract.categorizeError(webResults),
                details: toolSuccess ? `Synthesized ${synthesis.length} chars` : webResults
            });

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: toolSuccess ? "SUCCESS" : "FAILED",
                toolName: "web_search",
                toolOutput: webResults,
                verified: toolSuccess,
                verificationReason: toolSuccess ? "Web search results gathered and synthesized" : "Web search API unavailable or returned empty result",
                resultData: toolSuccess 
                    ? `### Research Synthesis\n\n${synthesis.trim()}` 
                    : (isErrorSnippet
                        ? `⚠️ [ResearchSubAgent Execution Error]: Search tool returned an error: ${webResults}` 
                        : `No live web search results found for this query.`),
                error: toolSuccess ? undefined : webResults,
                executionTimeMs
            };
        } catch (err: any) {
            const executionTimeMs = Date.now() - startTime;
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "FAILED",
                resultData: "",
                error: err.message || "ResearchSubAgent failed",
                executionTimeMs
            };
        }
    }
}
