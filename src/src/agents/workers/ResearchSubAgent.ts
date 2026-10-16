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
            const webSearchTool = SkillRegistry.getToolByName("web_search");
            if (webSearchTool) {
                try {
                    webResults = await webSearchTool.invoke({ query: task.taskDescription });
                } catch (e: any) {
                    webResults = `Web search offline: ${e.message}`;
                }
            }

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
            if (!router.isInFallbackMode()) {
                try {
                    const prompt = `You are ResearchSubAgent. Synthesize the findings for the user query: "${task.taskDescription}".
Web Search Results:
${webResults}

Knowledge Graph Context:
${graphResults}

Provide a clear, structured research summary in 3-4 bullet points.`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('RESEARCH_TIMEOUT')), 30000)
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
                    synthesis = webResults || "Research completed with basic search results.";
                }
            } else {
                synthesis = webResults || "Research completed with offline knowledge.";
            }

            const executionTimeMs = Date.now() - startTime;
            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: "SUCCESS",
                resultData: `### Research Synthesis\n\n${synthesis.trim()}`,
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
