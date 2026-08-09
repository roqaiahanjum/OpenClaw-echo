// @ts-nocheck
import { KnowledgeGraphManager } from "./KnowledgeGraphManager";
import { ModelRouter } from "../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export class GraphExtractor {
    private graph: KnowledgeGraphManager;

    constructor() {
        this.graph = KnowledgeGraphManager.getInstance();
    }

    public async extractAndStore(userMessage: string): Promise<number> {
        const text = userMessage.trim();
        if (!text || text.length < 5) return 0;

        let count = await this.extractRegexTriples(text);

        if (count === 0 && text.split(/\s+/).length > 4) {
            count = await this.extractTriplesViaLLM(text);
        }

        return count;
    }

    private async extractRegexTriples(text: string): Promise<number> {
        let extractedCount = 0;

        // Pattern 1: User name ("my name is X" / "call me X")
        const nameMatch = text.match(/(?:my name is|call me)\s+([A-Z][a-zA-Z]+)/i);
        if (nameMatch && nameMatch[1]) {
            const name = nameMatch[1].trim();
            await this.graph.addTriple("User", "IS_NAMED", name, { subjectType: "USER", objectType: "PERSON" });
            extractedCount++;
        }

        // Pattern 2: Project ("my project is X" / "working on X")
        const projectMatch = text.match(/(?:my project is|building|working on|developing)\s+([A-Za-z0-9\s\-_]+?)(?:\.|,|\s+as|\s+for|$)/i);
        if (projectMatch && projectMatch[1] && projectMatch[1].length > 3) {
            const project = projectMatch[1].trim();
            await this.graph.addTriple("User", "DEVELOPING_PROJECT", project, { subjectType: "USER", objectType: "PROJECT" });
            extractedCount++;
        }

        // Pattern 3: Tech stack ("project X uses Y" / "we use Y for Z")
        const techMatch = text.match(/(?:using|uses|built with|developed with)\s+([A-Za-z0-9\s\-_,]+?)\s+(?:for|as|in|$)/i);
        if (techMatch && techMatch[1]) {
            const tech = techMatch[1].trim();
            await this.graph.addTriple("OpenClaw Echo", "USES_TECH", tech, { subjectType: "PROJECT", objectType: "TECHNOLOGY" });
            extractedCount++;
        }

        // Pattern 4: Education ("study X at Y" / "student at Y")
        const eduMatch = text.match(/(?:studying|student at|study at)\s+([A-Za-z0-9\s]+?)(?:\.|,|$)/i);
        if (eduMatch && eduMatch[1]) {
            const inst = eduMatch[1].trim();
            await this.graph.addTriple("User", "ENROLLED_AT", inst, { subjectType: "USER", objectType: "ORGANIZATION" });
            extractedCount++;
        }

        return extractedCount;
    }

    public async extractTriplesViaLLM(userMessage: string): Promise<number> {
        try {
            const router = ModelRouter.getInstance();
            if (router.isInFallbackMode()) return 0;

            const prompt = `Extract knowledge graph triples (Subject, Predicate, Object) from the user message.
Return ONLY valid JSON array matching this format without markdown code blocks:
[
  { "subject": "User", "predicate": "LIKES", "object": "TypeScript" }
]`;

            const messages = [
                new SystemMessage(prompt),
                new HumanMessage(userMessage)
            ];

            const res = await router.invoke(messages, "graph_extractor");
            let raw = (res.content as string) || "";
            raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

            const triples = JSON.parse(raw);
            if (!Array.isArray(triples)) return 0;

            let added = 0;
            for (const t of triples) {
                if (t.subject && t.predicate && t.object) {
                    const ok = await this.graph.addTriple(t.subject, t.predicate, t.object);
                    if (ok) added++;
                }
            }
            return added;
        } catch (e: any) {
            console.warn("[GraphExtractor] LLM triple extraction skipped:", e.message);
            return 0;
        }
    }
}

export const graphExtractor = new GraphExtractor();

export async function extractAndStoreTriples(userMessage: string, chatId?: string): Promise<number> {
    return graphExtractor.extractAndStore(userMessage);
}

