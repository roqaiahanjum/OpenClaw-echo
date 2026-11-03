// @ts-nocheck
import { ACPTask, ACPResult, WorkerAgent } from "../types";
import { SkillRegistry } from "../../skills/registry";
import { KnowledgeGraphManager } from "../../memory/KnowledgeGraphManager";
import { ModelRouter } from "../../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ToolExecutionContract } from "../../core/toolExecutionContract";

interface VerifiedSource {
    title: string;
    url: string;
}

function parseVerifiedSources(text: string): VerifiedSource[] {
    const sources: VerifiedSource[] = [];
    const seenUrls = new Set<string>();
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
        const title = match[1].trim();
        const url = match[2].trim();
        if (!seenUrls.has(url) && url !== "#") {
            seenUrls.add(url);
            sources.push({ title, url });
        }
    }
    return sources;
}

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
            const qMatch = task.taskDescription.match(/(?:re?search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for|\s+about|\s+on|\s+into)?|look\s+up|find(?:\s+information)?(?:\s+on|\s+about)?|what\s+is|who\s+is|tell\s+me\s+about)\s+([^,.;\n]+?)(?:\s+(?:and\s+provide|and\s+tell|and\s+give|and\s+include|do\s+not|please\s+|with\s+sources|citing)|\.|$)/i);
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

            const verifiedSources = parseVerifiedSources(webResults);
            let synthesis = "";
            const router = ModelRouter.getInstance();

            if (!router.isInFallbackMode() && toolSuccess) {
                try {
                    const allowedUrlList = verifiedSources.length > 0 
                        ? verifiedSources.map(s => `- [${s.title}](${s.url})`).join("\n")
                        : "None (Cite no external URLs)";

                    const prompt = `You are ResearchSubAgent for OpenClaw Echo.
Synthesize a structured, factual answer for the research query: "${searchQuery}".

Verified Web Search Findings:
${webResults}

Knowledge Graph Context:
${graphResults}

ALLOWED CITATIONS (You may ONLY cite URLs from this list):
${allowedUrlList}

CRITICAL GROUNDING RULES:
1. Provide a clear, well-structured response answering the user's request.
2. Ground your answer strictly in the Verified Web Search Findings above.
3. DO NOT invent dates, announcements, versions, or events not present in the search findings.
4. DO NOT invent or hallucinate citations or URLs. Any cited link MUST come from the ALLOWED CITATIONS list.
5. If the search findings do not contain a requested detail, state clearly that it was not found in the search results rather than fabricating an answer.
6. Avoid dangling citation numbers at the end of sentences.`;

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('RESEARCH_TIMEOUT')), 25000)
                    );

                    const response: any = await Promise.race([
                        router.invoke([
                            new SystemMessage("You are a specialized factual research agent."),
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

            // --- Grounding & Anti-Hallucination Post-Processing ---
            if (synthesis && toolSuccess) {
                // 1. Clean dangling reference numbers at end of lines or sentences (e.g. "...data-driven insights. 23" -> "...data-driven insights.")
                synthesis = synthesis.replace(/(\.|\?|!)\s+\d{1,2}\s*$/gm, "$1");
                synthesis = synthesis.replace(/\s+\d{1,2}\s*$/gm, "");

                // 2. Validate all URLs in synthesis against verifiedSources whitelist
                const allowedUrls = new Set(verifiedSources.map(s => s.url));
                const urlRegex = /https?:\/\/[^\s)\]'"]+/g;
                const foundUrls = synthesis.match(urlRegex) || [];

                for (const rawUrl of foundUrls) {
                    if (!allowedUrls.has(rawUrl)) {
                        console.warn(`[ResearchSubAgent] Stripping unverified/hallucinated URL: ${rawUrl}`);
                        synthesis = synthesis.split(rawUrl).join("");
                    }
                }

                // Clean up empty markdown links caused by stripped URLs
                synthesis = synthesis.replace(/\[([^\]]+)\]\(\s*\)/g, "$1");

                // 3. Ensure verified sources are appended with clickable markdown links
                if (verifiedSources.length > 0) {
                    const hasSourcesHeader = /###?\s*(?:verified\s+)?sources/i.test(synthesis);
                    if (!hasSourcesHeader) {
                        const sourcesBlock = "\n\n### Sources\n" + verifiedSources.map((s, idx) => `${idx + 1}. [${s.title}](${s.url})`).join("\n");
                        synthesis = synthesis.trim() + sourcesBlock;
                    }
                }
            }

            const executionTimeMs = Date.now() - startTime;
            ToolExecutionContract.logExecution({
                requestId: task.taskId,
                selectedAgent: this.agentType,
                selectedTool: "web_search",
                executionStatus: toolSuccess ? "SUCCESS" : "FAILED",
                durationMs: executionTimeMs,
                errorCategory: toolSuccess ? "NONE" : ToolExecutionContract.categorizeError(webResults),
                details: toolSuccess ? `Synthesized ${synthesis.length} chars with ${verifiedSources.length} verified sources` : webResults
            });

            return {
                taskId: task.taskId,
                targetAgent: this.agentType,
                status: toolSuccess ? "SUCCESS" : "FAILED",
                toolName: "web_search",
                toolOutput: webResults,
                verified: toolSuccess,
                verificationReason: toolSuccess ? `Web search gathered ${verifiedSources.length} verified sources and synthesized grounded response` : "Web search API unavailable or returned empty result",
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
