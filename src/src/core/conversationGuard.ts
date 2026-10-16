/**
 * Fast Conversational Message Guard
 * Identifies simple conversational prompts and direct arithmetic that do not require tool calls.
 * Tool-dependent requests (code execution, goals, saved facts/memory, files, email, git, scheduling, web search/scraping)
 * MUST be routed to the autonomous tool path.
 */

// 1. Tool-dependent domains: ANY match here forces routing to the tool path (return false)
const TOOL_PATTERNS = [
    // Running/executing code
    /\b(run|execute|exec|eval|code|javascript|typescript|python|js|ts|py|script|sandbox|program|compile)\b/i,
    /console\.log/i,
    /```/,
    // Goals
    /\b(goals?|milestones?|objectives?)\b/i,
    // Saved facts / memory
    /\b(facts?|saved facts?|remember|recall|memory|user profile|preferences?|knowledge base)\b/i,
    // Files
    /\b(files?|folders?|directory|directories|read file|write file|create file|save file|delete file)\b/i,
    // Email
    /\b(emails?|mail|smtp|send email)\b/i,
    // Git
    /\b(git|commits?|branch(?:es)?|repos?|repository|status|diff|checkout|push|pull)\b/i,
    // Scheduling
    /\b(schedules?|scheduled|clockwork|cron|timers?|periodic|recurring|remind(?:er|ers)?)\b/i,
    // Web search / scraping
    /\b(search|web|google|browse|scrape|urls?|https?|websites?|weather|news)\b/i,
];

// 2. Simple arithmetic queries that can be answered directly on fast path
function isSimpleArithmetic(input: string): boolean {
    const trimmed = input.trim();
    // Direct math expressions: "2+2", "2 + 2", "15 * 4", "100 / 5", "25 - 7", etc.
    if (/^[-+]?[0-9]+(?:\.[0-9]+)?(?:\s*[\+\-\*\/\^\%]\s*[-+]?[0-9]+(?:\.[0-9]+)?)+\s*\??$/.test(trimmed)) {
        return true;
    }
    // Math questions without code: "what is 2 + 2?", "calculate 15 * 4", "how much is 10 + 20"
    if (/^(?:what\s+is|what's|calculate|compute|how\s+much\s+is|eval|evaluate)\s+[-+]?[0-9]+(?:\.[0-9]+)?(?:\s*[\+\-\*\/\^\%]\s*[-+]?[0-9]+(?:\.[0-9]+)?)+\s*\??$/i.test(trimmed)) {
        return true;
    }
    return false;
}

// 3. Conversational phrases and pleasantries
const CONVERSATIONAL_PATTERNS = [
    /^(?:hi|hello|hey|greetings|howdy)(?:\s+there)?[\s!.,?]*$/i,
    /^(?:good\s+(?:morning|afternoon|evening|night|day))[\s!.,?]*$/i,
    /^(?:how\s+are\s+you(?:\s+doing)?|whats\s+up|what's\s+up)[\s!.,?]*$/i,
    /^(?:who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do|tell\s+me\s+about\s+yourself|introduce\s+yourself)[\s!.,?]*$/i,
    /^(?:thank\s+you|thanks(?:\s+a\s+lot)?|you(?:'re|\s+are)\s+welcome)[\s!.,?]*$/i,
    /^(?:bye|goodbye|see\s+you(?:\s+later)?|farewell)[\s!.,?]*$/i,
    /^(?:ok|okay|cool|nice|awesome|sure|great|got\s+it|sounds\s+good)[\s!.,?]*$/i,
    /^(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh)[\s!.,?]*$/i
];

export function isSimpleConversation(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed) return true;

    // A. If ANY tool-dependent pattern matches, it MUST go to the tool path
    for (const pattern of TOOL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return false;
        }
    }

    // B. Keep simple arithmetic on the fast path
    if (isSimpleArithmetic(trimmed)) {
        return true;
    }

    // C. Keep simple greetings and pleasantries on the fast path
    for (const pattern of CONVERSATIONAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            return true;
        }
    }

    // All other queries default to tool path
    return false;
}
