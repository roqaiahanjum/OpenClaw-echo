import { ModelRouter } from "../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export interface ExtractedFact {
    category: "project" | "user_profile" | "preference" | "infrastructure" | "entity" | "user_memory";
    key: string;
    value: string;
    confidence: number;
    rawStatement: string;
    aliases?: string[];
}

/**
 * OpenClaw Echo — Fact Extraction Engine
 * 
 * Transforms natural language memory requests into structured, stable, canonical facts.
 * Generates clean snake_case keys (e.g. "sample_project_name") rather than concatenated word fragments.
 */
export class FactExtractionEngine {
    private static instance: FactExtractionEngine;

    public static getInstance(): FactExtractionEngine {
        if (!FactExtractionEngine.instance) {
            FactExtractionEngine.instance = new FactExtractionEngine();
        }
        return FactExtractionEngine.instance;
    }

    /**
     * Sanitizes a string into a clean, stable snake_case identifier.
     */
    public static toCleanSnakeCase(input: string, maxLen: number = 32): string {
        return input
            .trim()
            .toLowerCase()
            .replace(/['"’]/g, "")
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, maxLen)
            .replace(/^_+|_+$/g, "");
    }

    /**
     * Deterministic rule-based extraction for common user fact patterns.
     * Guaranteed sub-millisecond execution with 100% stability.
     */
    public extractWithRules(input: string): ExtractedFact | null {
        const text = input.trim();
        const lower = text.toLowerCase();

        // Strip leading directive prefixes: "remember that", "please remember", "save this:", "note down that"
        const directiveMatch = text.match(/^(?:please\s+)?(?:remember(?:\s+that)?|save(?:\s+(?:that|this))?|store(?:\s+that)?|memorize(?:\s+that)?|note\s+down(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?)\s*[:,-]?\s*(.+)/i);
        const statement = (directiveMatch && directiveMatch[1] ? directiveMatch[1].trim() : text)
            .replace(/^(?:my\s+)/i, "my ")
            .replace(/[.!,;]+$/g, "")
            .trim();

        // If there are multiple clauses or a follow-up question (e.g. "my favorite programming language is Python. What did I tell you?"),
        // prioritize the fact clause before evaluating rules.
        const clauses: string[] = [statement];
        const sentenceSplit = statement.split(/(?<=[.!?])\s+|\s+(?=(?:what|which|where|who|when|how|did|do|can)\s+)/i);
        if (sentenceSplit.length > 1 && sentenceSplit[0].trim()) {
            clauses.unshift(sentenceSplit[0].replace(/[.!,;?]+$/g, "").trim());
        }

        for (const candidateStatement of clauses) {
            const result = this.evaluateStatementRules(candidateStatement, input);
            if (result) return result;
        }

        return null;
    }

    private evaluateStatementRules(statement: string, input: string): ExtractedFact | null {

        // 1. Projects: sample project, demo project, side project, main project
        // "my sample project is called Aurora" -> category: project, key: sample_project_name, value: Aurora
        const projectNamedMatch = statement.match(/^(?:my\s+)?(sample|demo|test|side|main|current)?\s*project(?:\s+name)?\s+(?:is\s+(?:called\s+|named\s+)?|called\s+|named\s+)\s*['"]?([A-Za-z0-9_\-\s.]+?)['"]?$/i);
        if (projectNamedMatch) {
            const modifier = projectNamedMatch[1] ? projectNamedMatch[1].toLowerCase().trim() : "";
            const rawVal = projectNamedMatch[2].trim();
            const key = modifier ? `${modifier}_project_name` : "project_name";
            return {
                category: "project",
                key,
                value: rawVal,
                confidence: 1.0,
                rawStatement: input,
                aliases: [
                    key,
                    modifier ? `${modifier}_project` : "project",
                    `${key}_is_called_${FactExtractionEngine.toCleanSnakeCase(rawVal, 10)}`
                ]
            };
        }

        // "working on a project called Aurora" / "developing Aurora"
        const projectWorkingMatch = statement.match(/(?:working\s+on|building|developing)\s+(?:a\s+)?(?:project\s+(?:called\s+|named\s+)?)?['"]?([A-Za-z0-9_\-\s]+?)['"]?$/i);
        if (projectWorkingMatch && projectWorkingMatch[1] && projectWorkingMatch[1].length > 2) {
            const val = projectWorkingMatch[1].trim();
            if (!["something", "code", "it", "stuff"].includes(val.toLowerCase())) {
                return {
                    category: "project",
                    key: "current_project",
                    value: val,
                    confidence: 0.95,
                    rawStatement: input,
                    aliases: ["project_name", "project"]
                };
            }
        }

        // 2. User Profile: Name
        const nameMatch = statement.match(/^(?:my\s+name\s+is|call\s+me|i\s+am)\s+([A-Za-z0-9\s'-]+)$/i);
        if (nameMatch && nameMatch[1]) {
            const candidate = nameMatch[1].trim();
            const lowerCand = candidate.toLowerCase();
            const nonNames = ["a student", "a developer", "an engineer", "working", "building", "here", "ready", "fine", "ok"];
            if (!nonNames.includes(lowerCand) && !lowerCand.startsWith("a ") && !lowerCand.startsWith("an ")) {
                return {
                    category: "user_profile",
                    key: "user_name",
                    value: candidate,
                    confidence: 1.0,
                    rawStatement: input,
                    aliases: ["name", "user_name"]
                };
            }
        }

        // 3. User Profile: Email & Phone
        const emailMatch = statement.match(/(?:my\s+email(?:\s+address)?\s+is\s+)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch && emailMatch[1]) {
            return {
                category: "user_profile",
                key: "email",
                value: emailMatch[1].trim(),
                confidence: 1.0,
                rawStatement: input,
                aliases: ["email_address", "user_email"]
            };
        }

        // 4. User Profile: College / University
        const collegeMatchWithSuffix = statement.match(/(?:i\s+study\s+at|my\s+(?:college|university|institute)\s+is|at|from)\s+([A-Za-z0-9\s]+?)\s+(college|university|institute|institution)/i);
        if (collegeMatchWithSuffix && collegeMatchWithSuffix[1]) {
            const colName = `${collegeMatchWithSuffix[1].trim()} ${collegeMatchWithSuffix[2].charAt(0).toUpperCase() + collegeMatchWithSuffix[2].slice(1).toLowerCase()}`;
            return {
                category: "user_profile",
                key: "college",
                value: colName,
                confidence: 1.0,
                rawStatement: input,
                aliases: ["university", "school", "institution", "college_name"]
            };
        }

        const collegeDirectMatch = statement.match(/^(?:i\s+(?:study\s+at|attend|go\s+to)|my\s+(?:college|university|institute|school)\s+is)\s+([A-Za-z0-9\s.'-]+)$/i);
        if (collegeDirectMatch && collegeDirectMatch[1]) {
            const candidate = collegeDirectMatch[1].trim();
            const lowerCand = candidate.toLowerCase();
            if (!lowerCand.startsWith("home") && !lowerCand.startsWith("night") && candidate.length > 1) {
                return {
                    category: "user_profile",
                    key: "college",
                    value: candidate,
                    confidence: 1.0,
                    rawStatement: input,
                    aliases: ["university", "school", "institution", "college_name"]
                };
            }
        }

        // 5. User Profile: Student Type / Major
        const studentMatch = statement.match(/(?:i\s+am\s+(?:a|an)\s+|studying|student\s+of\s+)([a-zA-Z\s]+?)\s+(?:student|degree|dept|department|major)/i);
        if (studentMatch && studentMatch[1]) {
            return {
                category: "user_profile",
                key: "student_type",
                value: studentMatch[1].trim(),
                confidence: 0.95,
                rawStatement: input,
                aliases: ["major", "degree"]
            };
        }

        // 6. User Profile: Academic Year
        const yearMatch = statement.match(/(?:i\s+am\s+in\s+)?(final|1st|2nd|3rd|4th|first|second|third|fourth)\s+year/i);
        if (yearMatch && yearMatch[1]) {
            return {
                category: "user_profile",
                key: "academic_year",
                value: `${yearMatch[1].toLowerCase()} year`,
                confidence: 1.0,
                rawStatement: input,
                aliases: ["year", "college_year"]
            };
        }

        // 7. Preferences: Favorite X is Y
        // "my favorite programming language is Rust" -> category: preference, key: favorite_programming_language, value: Rust
        const favMatch = statement.match(/^(?:my\s+)?(?:favorite|favourite|preferred)\s+([a-zA-Z0-9_\-\s]+?)\s+is\s+([A-Za-z0-9_\-\s.+]+)$/i);
        if (favMatch && favMatch[1] && favMatch[2]) {
            const subject = FactExtractionEngine.toCleanSnakeCase(favMatch[1], 24);
            const val = favMatch[2].trim();
            const key = `favorite_${subject}`;
            return {
                category: "preference",
                key,
                value: val,
                confidence: 1.0,
                rawStatement: input,
                aliases: [key, `preferred_${subject}`, subject]
            };
        }

        // "i prefer X over Y" / "i prefer X"
        const preferMatch = statement.match(/^(?:i\s+)?prefer\s+([A-Za-z0-9_\-\s.+]+?)(?:\s+over\s+([A-Za-z0-9_\-\s.+]+))?$/i);
        if (preferMatch && preferMatch[1]) {
            const val = preferMatch[1].trim();
            return {
                category: "preference",
                key: `preferred_${FactExtractionEngine.toCleanSnakeCase(val, 20)}`,
                value: val,
                confidence: 0.9,
                rawStatement: input,
                aliases: ["preference"]
            };
        }

        // 8. Infrastructure / Stack
        const infraMatch = statement.match(/^(?:my|our)\s+(database|db|cloud|hosting|deployment|os|platform|framework|server)\s+is\s+([A-Za-z0-9_\-\s.+]+)$/i);
        if (infraMatch && infraMatch[1] && infraMatch[2]) {
            let catType = infraMatch[1].toLowerCase();
            if (catType === "db") catType = "database";
            const val = infraMatch[2].trim();
            return {
                category: "infrastructure",
                key: catType,
                value: val,
                confidence: 1.0,
                rawStatement: input,
                aliases: [catType, `${catType}_name`]
            };
        }

        // 9. Generic "my X is called Y" or "my X is Y"
        // e.g. "my cat is called Luna", "my dog's name is Max"
        const entityNamedMatch = statement.match(/^(?:my\s+)?([a-zA-Z0-9_\-\s]+?)(?:'s\s+name|\s+name)?\s+(?:is\s+(?:called\s+|named\s+)?|called\s+|named\s+)\s*['"]?([A-Za-z0-9_\-\s.+]+?)['"]?$/i);
        if (entityNamedMatch && entityNamedMatch[1] && entityNamedMatch[2]) {
            const rawSubject = entityNamedMatch[1].trim();
            const rawVal = entityNamedMatch[2].trim();
            const cleanSub = FactExtractionEngine.toCleanSnakeCase(rawSubject, 24);
            const key = cleanSub.endsWith("name") ? cleanSub : `${cleanSub}_name`;
            return {
                category: "entity",
                key,
                value: rawVal,
                confidence: 0.95,
                rawStatement: input,
                aliases: [key, cleanSub]
            };
        }

        return null;
    }

    /**
     * Extracts fact using LLM with deterministic rule fallback.
     */
    public async extractFact(input: string): Promise<ExtractedFact> {
        // 1. First attempt deterministic high-confidence rule extraction
        const ruleFact = this.extractWithRules(input);
        if (ruleFact && ruleFact.confidence >= 0.95) {
            return ruleFact;
        }

        // 2. Attempt LLM structured extraction for arbitrary conversational statements
        try {
            const router = ModelRouter.getInstance();
            const systemPrompt = `You are an expert AI Information Extraction Engine.
Extract the core user fact from the user's natural language statement into valid JSON.
Generate a concise, canonical snake_case key (max 30 chars, e.g. "sample_project_name", "favorite_editor", "dog_name").
NEVER concatenate raw sentence words into run-on keys like "sampleprojectiscalledauror".
Extract the pure value (e.g. "Aurora").

Output ONLY a JSON object with this exact structure:
{
  "category": "project" | "user_profile" | "preference" | "infrastructure" | "entity" | "user_memory",
  "key": "canonical_snake_case_key",
  "value": "extracted value",
  "confidence": 0.95
}`;

            const response: any = await router.invokeWithRetry([
                new SystemMessage(systemPrompt),
                new HumanMessage(input)
            ], "fast");

            const text = (response?.content as string || "").trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.key && parsed.value) {
                    const cleanKey = FactExtractionEngine.toCleanSnakeCase(parsed.key, 32);
                    return {
                        category: parsed.category || "user_memory",
                        key: cleanKey,
                        value: String(parsed.value).trim(),
                        confidence: parsed.confidence || 0.9,
                        rawStatement: input,
                        aliases: [cleanKey]
                    };
                }
            }
        } catch (err: any) {
            console.warn("[FactExtractionEngine] LLM extraction warning:", err.message);
        }

        // 3. Robust fallback if LLM is unavailable:
        if (ruleFact) {
            return ruleFact;
        }

        // General fallback: clean subject extraction
        const fallbackDirective = input.match(/(?:remember|store|save|memorize)\s+(?:that\s+)?(.+)/i);
        const rawContent = (fallbackDirective ? fallbackDirective[1] : input).replace(/[.!,;]+$/g, "").trim();
        const parts = rawContent.split(/\s+(?:is|are|called|named|was|=)\s+/i);

        let key = "custom_fact";
        let value = rawContent;

        if (parts.length >= 2) {
            const subject = FactExtractionEngine.toCleanSnakeCase(parts[0].replace(/^(?:my\s+|the\s+)/i, ""), 24);
            if (subject.length > 2) {
                key = subject;
                value = parts.slice(1).join(" is ").trim();
            }
        }

        return {
            category: "user_memory",
            key: key || "custom_fact",
            value,
            confidence: 0.8,
            rawStatement: input,
            aliases: [key]
        };
    }
}

