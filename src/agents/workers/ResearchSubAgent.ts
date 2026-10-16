// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { KnowledgeGraphManager } from "../../memory/KnowledgeGraphManager";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

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
            const qMatch = task.taskDescription.match(/research\s+(?:the\s+)?([^,.;]+)/i);
            if (qMatch && qMatch[1]) {
                searchQuery = qMatch[1].trim();
            }

            const webSearchTool = SkillRegistry.getToolByName("web_search");
            if (webSearchTool) {
                try {
                    webResults = String(await webSearchTool.invoke({ query: searchQuery }));
                    toolSuccess = !webResults.toLowerCase().includes("fatal") && webResults.length > 30;
                } catch (e: any) {
                    webResults = `Web search error: ${e.message}`;
                    toolSuccess = false;
                }
            } else {
                webResults = "web_search tool is not registered in registry.";
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
                    const prompt = `You are ResearchSubAgent. Synthesize the findings for the research query: "${searchQuery}".
Web Search Results:
${webResults}

Knowledge Graph Context:
${graphResults}

Provide a clear, structured research summary in 3-4 concise bullet points with cited sources.`;

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
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: toolSuccess ? "SUCCESS" : "FAILED",
                resultData: toolSuccess ? `### Research Synthesis\n\n${synthesis.trim()}` : `⚠️ [ResearchSubAgent Partial]: ${webResults}`,
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
