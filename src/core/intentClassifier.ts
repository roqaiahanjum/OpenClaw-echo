import { TargetAgentType } from "../agents/types";

/**
 * OpenClaw Echo — Mandatory Tool Intent Classification Engine
 * 
 * Determines user intent and routes every authorized incoming message
 * to a specialized SubAgent and mandatory tool pipeline:
 * - CONVERSATION: ConversationSubAgent (get_conversation_context tool)
 * - RESEARCH_ONLY: ResearchSubAgent (web_search, knowledge graph traversal)
 * - BROWSER_ONLY: BrowserSubAgent (scrape_website)
 * - CODING_ONLY: CodingSubAgent (write_sandbox_file, run_sandbox_code)
 * - MEMORY_ONLY: MemorySubAgent (save_knowledge, search_memory, get_all_knowledge)
 * - MULTI_AGENT: PlannerSubAgent (task decomposition, dependency graph execution)
 * - GENERAL_TOOL: Subsystem tools (goals, git, clockwork, email)
 */

export type UserIntent = 
    | "CONVERSATION" 
    | "RESEARCH_ONLY" 
    | "BROWSER_ONLY" 
    | "CODING_ONLY" 
    | "MEMORY_ONLY"
    | "MULTI_AGENT" 
    | "GENERAL_TOOL";

export interface IntentDecision {
    intent: UserIntent;
    primaryAgent: TargetAgentType;
    reason: string;
    targetAgents: TargetAgentType[];
    confidence: number;
    meta?: Record<string, any>;
}

// 1. Explicit Coding Intent: User explicitly asks to generate, write, or save code
export const EXPLICIT_CODING_PATTERNS = [
    /\b(?:write|generate|create|implement|build|code|make)\s+(?:a\s+|some\s+)?(?:[a-zA-Z0-9_\-]+\s+)*(?:code|script|function|program|class|solution|algorithm|benchmark|test|example|sample|demo|snippet|file|ts file|js file|sandbox file)\b/i,
    /\b(?:create|write|save|generate|make)\s+(?:a\s+)?(?:[a-zA-Z0-9_\-]+\s+)*(?:file|sandbox file|ts file|js file|script)\b/i,
    /\b(?:save|write)\s+(?:it\s+)?(?:in|into|to)\s+[a-zA-Z0-9_\-]+\.(?:ts|js|json|py|txt)\b/i,
    /\b[a-zA-Z0-9_\-]+\.(?:ts|js|py)\b/i,
    /\b(?:in\s+the\s+sandbox|sandbox\s+file)\b/i,
    /\b(?:code\s+example|code\s+snippet|sample\s+code|example\s+file|sample\s+file)\b/i,
    /\b(?:run\s+(?:this\s+)?(?:javascript|js|typescript|ts|python|py|code|script)|execute\s+(?:the\s+)?(?:code|script))\b/i
];

// 2. Explicit Browsing Intent: User specifically asks to browse or scrape a URL
export const EXPLICIT_BROWSER_PATTERNS = [
    /https?:\/\/[^\s"'<>)]+/i,
    /\b(?:browse|scrape|fetch|visit|read|open|analyze\s+this)\s+(?:the\s+)?(?:url|webpage|website|link|page|documentation|docs)\b/i,
    /\b(?:official\s+docs|online\s+documentation|official\s+documentation)\b/i
];

// 3. Explicit Research Intent: User specifically asks to research or investigate a topic
export const EXPLICIT_RESEARCH_PATTERNS = [
    /\b(?:research|investigate|study|overview of|literature on|survey of)\b/i,
    /\b(?:what\s+are\s+the\s+latest|latest\s+advancements|latest\s+news|recent\s+developments)\b/i,
    /\b(?:find\s+information|look\s+up|search\s+for|search\s+latest)\b/i,
    /\b(?:history\s+of|benefits\s+of|architecture\s+of|comparison\s+of)\b/i
];

// 4. Explicit Memory Intent: User specifically asks to remember or recall saved facts
export const EXPLICIT_MEMORY_PATTERNS = [
    /\b(?:remember\s+(?:that|my|this)|store\s+(?:fact|knowledge|that)|save\s+(?:fact|knowledge|note))\b/i,
    /\b(?:what\s+did\s+i\s+save|what\s+do\s+you\s+remember|recall|search\s+memory|saved\s+facts?|my\s+notes?)\b/i,
    /\b(?:get\s+all\s+knowledge|memory\s+stats|what\s+is\s+in\s+memory|recall\s+fact)\b/i
];

// 5. Simple Conversation & Pleasantries Patterns
const CONVERSATIONAL_PATTERNS = [
    /^(?:hi|hello|hey|greetings|howdy)(?:\s+there)?[\s!.,?]*$/i,
    /^(?:good\s+(?:morning|afternoon|evening|night|day))[\s!.,?]*$/i,
    /^(?:how\s+are\s+you(?:\s+doing)?|whats\s+up|what's\s+up)[\s!.,?]*$/i,
    /^(?:who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do|tell\s+me\s+about\s+yourself|introduce\s+yourself)[\s!.,?]*$/i,
    /^(?:thank\s+you|thanks(?:\s+a\s+lot)?|you(?:'re|\s+are)\s+welcome)[\s!.,?]*$/i,
    /^(?:bye|goodbye|see\s+you(?:\s+later)?|farewell)[\s!.,?]*$/i,
    /^(?:ok|okay|cool|nice|awesome|sure|great|got\s+it|sounds\s+good)[\s!.,?]*$/i,
    /^(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh)[\s!.,?]*$/i,
    /^(?:ping|test)[\s!.,?]*$/i
];

// 6. General Tool Patterns (Goals, Email, Git, Clockwork)
const GENERAL_TOOL_PATTERNS = [
    /\b(?:my\s+goals?|list\s+goals?|add\s+goal|create\s+goal|milestones?)\b/i,
    /\b(?:user\s+profile|my\s+preferences)\b/i,
    /\b(?:send\s+(?:an?\s+|the\s+|me\s+an?\s+)?(?:email|mail)|email\s+to|mail\s+to|smtp|send_email|email\s+report|check\s+(?:the\s+)?(?:smtp|email))\b/i,
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/i,
    /\b(?:git\s+status|git\s+commit|git\s+diff|git\s+log)\b/i,
    /\b(?:set\s+timer|cron|schedule\s+task|clockwork)\b/i
];

/**
 * Classifies an incoming user prompt into an actionable intent decision with mandatory subagent routing.
 */
export function classifyUserIntent(input: string): IntentDecision {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();

    if (!trimmed) {
        return {
            intent: "CONVERSATION",
            primaryAgent: "conversation",
            reason: "Empty input defaults to conversational greeting.",
            targetAgents: ["conversation"],
            confidence: 1.0
        };
    }

    // A. Check for conversational pleasantries (e.g., "Hello")
    if (CONVERSATIONAL_PATTERNS.some(p => p.test(trimmed))) {
        return {
            intent: "CONVERSATION",
            primaryAgent: "conversation",
            reason: "Input matches conversational greeting; routing to ConversationSubAgent with get_conversation_context tool.",
            targetAgents: ["conversation"],
            confidence: 0.98
        };
    }

    // B. Check for explicit memory operations
    if (EXPLICIT_MEMORY_PATTERNS.some(p => p.test(lower))) {
        return {
            intent: "MEMORY_ONLY",
            primaryAgent: "memory",
            reason: "User requested persistent memory storage, recall, or search.",
            targetAgents: ["memory"],
            confidence: 0.96
        };
    }

    // C. Evaluate Agent Triggers
    const hasCodeIntent = EXPLICIT_CODING_PATTERNS.some(p => p.test(lower));
    const hasBrowserIntent = EXPLICIT_BROWSER_PATTERNS.some(p => p.test(lower));
    const hasResearchIntent = EXPLICIT_RESEARCH_PATTERNS.some(p => p.test(lower));

    // Notice: "write a summary" or "write a report" is NOT code intent!
    const isTextSummaryOnly = /\b(?:write|give|provide|summarize)\s+(?:a\s+|an\s+)?(?:summary|report|overview|explanation|analysis|brief)\b/i.test(lower) &&
        !/\b(?:code|script|function|file|\.ts|\.js|\.py|sandbox)\b/i.test(lower);

    const actualCodeIntent = hasCodeIntent && !isTextSummaryOnly;

    // Multi-Agent Swarm Detection
    const hasMultiStepKeywords = /\b(?:multi-step|multi-agent|step\s+by\s+step|first\s+.+\s+then|in\s+parallel|and\s+then|research\s+and\s+(?:generate|write|create))\b/i.test(lower);
    const activeAgentCount = (hasResearchIntent ? 1 : 0) + (hasBrowserIntent ? 1 : 0) + (actualCodeIntent ? 1 : 0);

    if (hasMultiStepKeywords || activeAgentCount >= 2) {
        const targetAgents: TargetAgentType[] = ["planner"];
        if (hasResearchIntent || lower.includes("research")) targetAgents.push("research");
        if (hasBrowserIntent || lower.includes("browse") || lower.includes("http")) targetAgents.push("browser");
        if (actualCodeIntent || lower.includes("code") || lower.includes("script")) targetAgents.push("coding");

        if (targetAgents.length < 3) {
            if (hasResearchIntent && !targetAgents.includes("coding")) targetAgents.push("coding");
            else if (actualCodeIntent && !targetAgents.includes("research")) targetAgents.push("research");
        }

        return {
            intent: "MULTI_AGENT",
            primaryAgent: "planner",
            reason: `Multi-step request detected requiring coordination between ${targetAgents.filter(a => a !== 'planner').join(" + ")}.`,
            targetAgents,
            confidence: 0.94
        };
    }

    // Pure Code Generation Request
    if (actualCodeIntent && !hasResearchIntent && !hasBrowserIntent) {
        return {
            intent: "CODING_ONLY",
            primaryAgent: "coding",
            reason: "User requested code generation or sandbox execution; routing to CodingSubAgent.",
            targetAgents: ["coding"],
            confidence: 0.95
        };
    }

    // Pure Web Browsing Request
    if (hasBrowserIntent && !actualCodeIntent && !hasResearchIntent) {
        return {
            intent: "BROWSER_ONLY",
            primaryAgent: "browser",
            reason: "User requested visiting or scraping a web URL/documentation; routing to BrowserSubAgent.",
            targetAgents: ["browser"],
            confidence: 0.95
        };
    }

    // Pure Research Request
    if (hasResearchIntent && !actualCodeIntent && !hasBrowserIntent) {
        return {
            intent: "RESEARCH_ONLY",
            primaryAgent: "research",
            reason: "User requested topic research and intelligence synthesis; routing to ResearchSubAgent.",
            targetAgents: ["research"],
            confidence: 0.95
        };
    }

    // Subsystem Tools (Goals, Git, Clockwork, Email)
    if (GENERAL_TOOL_PATTERNS.some(p => p.test(lower))) {
        return {
            intent: "GENERAL_TOOL",
            primaryAgent: "memory",
            reason: "Input targets specialized subsystem tool; routing via Memory/Tool pipeline.",
            targetAgents: ["memory"],
            confidence: 0.95
        };
    }

    // Informational question (e.g. "What is TypeScript?", "Explain how neural networks work")
    const isGeneralQuestion = /^(?:what|why|how|who|when|where|explain|can you explain|define|tell me about)\b/i.test(trimmed);
    if (isGeneralQuestion && !actualCodeIntent && !hasBrowserIntent) {
        return {
            intent: "CONVERSATION",
            primaryAgent: "conversation",
            reason: "General informational question routed to ConversationSubAgent with get_conversation_context tool.",
            targetAgents: ["conversation"],
            confidence: 0.90
        };
    }

    // Fallback: If research or search keywords match loosely
    if (hasResearchIntent) {
        return {
            intent: "RESEARCH_ONLY",
            primaryAgent: "research",
            reason: "Defaulted to research subagent based on query keywords.",
            targetAgents: ["research"],
            confidence: 0.85
        };
    }

    // Default to ConversationSubAgent with mandatory conversationContextTool
    return {
        intent: "CONVERSATION",
        primaryAgent: "conversation",
        reason: "Standard interaction routed to ConversationSubAgent with get_conversation_context tool.",
        targetAgents: ["conversation"],
        confidence: 0.80
    };
}
