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

// 3. Explicit Research Intent: User specifically asks for live web search, recent 2026 events, or citations
export const EXPLICIT_RESEARCH_PATTERNS = [
    /\b(?:re?search(?:\s+(?:the\s+)?(?:web|internet|online))?|conduct\s+research|literature\s+(?:review|on)|scientific\s+study|clinical\s+study)\b/i,
    /\b(?:search(?:\s+(?:the\s+(?:web|internet)|online|google|bing))(?:\s+for)?|look\s+up\s+online|find\s+(?:online\s+)?sources|web\s+search)\b/i,
    /\b(?:what\s+are\s+the\s+latest|latest\s+advancements|latest\s+news|recent\s+developments|current\s+status\s+of|today's\s+news)\b/i,
    /\b(?:in\s+2025|in\s+2026|recently\s+released|current\s+price|market\s+price|live\s+scores?)\b/i,
    /\b(?:with\s+citations|citing\s+sources|provide\s+sources|give\s+sources|with\s+links)\b/i
];

// 4. Explicit Memory Intent: User specifically asks to remember or recall saved facts
export const EXPLICIT_MEMORY_PATTERNS = [
    /\b(?:remember\s+(?:that|my|this)|store\s+(?:fact|knowledge|that)|save\s+(?:fact|knowledge|note)|memorize|keep\s+in\s+mind|note\s+down)\b/i,
    /\b(?:what\s+did\s+i\s+save|what\s+do\s+you\s+remember|recall|search\s+memory|saved\s+facts?|my\s+notes?)\b/i,
    /\b(?:get\s+all\s+knowledge|memory\s+stats|what\s+is\s+in\s+memory|recall\s+fact)\b/i,
    /\b(?:what(?:'s|\s+is)\s+my\s+name|who\s+am\s+i|do\s+you\s+(?:know|remember)\s+my\s+name|tell\s+me\s+my\s+name|what\s+is\s+my\s+identity)\b/i,
    /\b(?:my\s+name\s+is|call\s+me)\s+[A-Za-z0-9\s'-]+/i,
    // Generalized history queries (numeric or word limits)
    /\b(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:questions?|messages?|chats?|turns?|queries|inquiries)\b/i,
    /\b(?:what\s+(?:was|were)\s+(?:my|the)\s+(?:last|previous|recent)\s+(?:\d+|one|two|three|four|five)?\s*(?:question|questions|message|messages)|what\s+did\s+i\s+(?:last|just|previously)\s*(?:ask|say)|which\s+question\s+did\s+i\s+ask|conversation\s+history)\b/i,
    // Inquiries about user facts, state, identity, location, background
    /\b(?:where|what|which|who|when|how)\s+(?:is|was|are|were|do|did|am|have)\s+(?:my|i)\b/i,
    // Questions about personal attributes or possessions (e.g. "which college am I attending", "what project am I building")
    /\b(?:which|what)\s+[a-z0-9_\-\s]+?\s+(?:am\s+i|do\s+i|did\s+i|i\s+am|i\s+study|i\s+work|i\s+live|i\s+attend)\b/i,
    // Recall queries with personal scope
    /\b(?:do\s+you\s+(?:remember|know|recall)|can\s+you\s+(?:remember|recall))\s+(?:what|where|which|who|when|how|my|about\s+my|the\s+name\s+of\s+my)\b/i
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
    /\b(?:my\s+goals?|list\s+goals?|(?:add|create|update|complete|manage)\s+(?:a\s+|the\s+|new\s+)?(?:project\s+)?(?:goals?|milestones?)|project\s+goals?|milestones?)\b/i,
    /\b(?:user\s+profile|my\s+preferences)\b/i,
    /\b(?:send\s+(?:an?\s+|the\s+|me\s+an?\s+)?(?:email|mail)|email\s+to|mail\s+to|smtp|send_email|email\s+report|check\s+(?:the\s+)?(?:smtp|email))\b/i,
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/i,
    /\b(?:git\s+status|git\s+commit|git\s+diff|git\s+log)\b/i,
    /\b(?:set\s+timer|cron|schedule(?:\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?task)?|clockwork)\b/i
];

/**
 * Checks whether the incoming message is a follow-up referring to the ongoing conversation.
 */
export function isFollowUpQuery(input: string, contextTurns?: Array<{ user: string; bot?: string } | string>): boolean {
    if (!contextTurns || !Array.isArray(contextTurns) || contextTurns.length === 0) {
        return false;
    }

    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();

    // 1. Follow-up requests for examples, elaboration, simplification, clarification
    const followUpPatterns = [
        /^(?:can\s+you\s+)?(?:give|provide|show)\s+(?:me\s+)?(?:an?\s+)?(?:real[\s\-]world\s+)?example\b/i,
        /^(?:can\s+you\s+)?(?:explain|clarify|elaborate|expand|simplify|break\s+down)\s+(?:that|this|it|more|further)\b/i,
        /\b(?:with\s+(?:an?\s+)?example|give\s+(?:me\s+)?(?:an?\s+)?example|another\s+example|more\s+examples?)\b/i,
        /^(?:what\s+about|how\s+about|why\s+is\s+that|why\s+so|how\s+so)\b/i,
        /^(?:tell\s+me\s+more|more\s+details?|elaborate|clarify|continue|go\s+on)\b/i,
        /^(?:can\s+you\s+)?(?:explain\s+further|explain\s+more|say\s+more)\b/i,
        /^(?:does\s+that\s+mean|in\s+other\s+words|meaning\s+what)\b/i,
        /^(?:what\s+do\s+you\s+mean|can\s+you\s+rephrase|in\s+simple\s+terms)\b/i,
        /^(?:and\s+why|and\s+how|so\s+what)\b/i
    ];

    if (followUpPatterns.some(p => p.test(trimmed))) {
        return true;
    }

    // 2. Anaphoric pronoun references without a standalone subject (e.g. "How does it work?", "Why is that?")
    const hasAnaphoricReference = /\b(that|this|it|those|these|the\s+former|the\s+latter)\b/i.test(lower);
    const isShortQuery = trimmed.split(/\s+/).length <= 10;
    if (hasAnaphoricReference && isShortQuery) {
        if (!/\b(remember\s+that|save\s+that|what\s+is\s+that|delete\s+that)\b/i.test(lower)) {
            return true;
        }
    }

    return false;
}

/**
 * Classifies an incoming user prompt into an actionable intent decision with mandatory subagent routing.
 */
export function classifyUserIntent(input: string, contextTurns?: Array<{ user: string; bot?: string } | string>): IntentDecision {
    const trimmed = input.trim();
    let lower = trimmed.toLowerCase();

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

    // B. Check for explicit memory operations (user facts, saved info, history questions)
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

    // D. Multi-Turn Context Follow-Up Resolution
    // Resolves follow-ups using both ongoing dialogue history and current task objective
    if (isFollowUpQuery(trimmed, contextTurns)) {
        const lastTurn = contextTurns && contextTurns.length > 0 ? contextTurns[contextTurns.length - 1] : null;
        const lastUser = lastTurn ? (typeof lastTurn === "string" ? lastTurn : (lastTurn.user || "")) : "";
        const lastBot = lastTurn ? (typeof lastTurn === "string" ? "" : (lastTurn.bot || "")) : "";
        const lastWasCoding = /```(?:ts|js|py|python|typescript|javascript|bash|sh|json)/i.test(lastBot) || EXPLICIT_CODING_PATTERNS.some(p => p.test(lastUser));
        const lastWasResearch = /### Sources|https?:\/\//i.test(lastBot) || EXPLICIT_RESEARCH_PATTERNS.some(p => p.test(lastUser));

        // 1. Coding follow-up (inherits coding pipeline if previous turn was code or follow-up targets code)
        const isCodingFollowUp = actualCodeIntent || (lastWasCoding && /\b(?:test|tests?|debug|fix|refactor|optimize|handle|error|null|exception|run|add|implement)\b/i.test(lower));
        if (isCodingFollowUp) {
            return {
                intent: "CODING_ONLY",
                primaryAgent: "coding",
                reason: "Contextual follow-up requesting code implementation, refactoring, or tests for previous code.",
                targetAgents: ["coding"],
                confidence: 0.96
            };
        }

        // 2. Web research follow-up (inherits research pipeline if previous turn was research or follow-up asks for sources/news)
        const isResearchFollowUp = hasResearchIntent || (lastWasResearch && /\b(?:other|more\s+sources?|more\s+findings?|cite|references?|news|updates?|who\s+else)\b/i.test(lower));
        if (isResearchFollowUp) {
            return {
                intent: "RESEARCH_ONLY",
                primaryAgent: "research",
                reason: "Contextual follow-up requesting additional live research or sources for previous research topic.",
                targetAgents: ["research"],
                confidence: 0.96
            };
        }

        // 3. Conversational explanation / clarification / example follow-up
        return {
            intent: "CONVERSATION",
            primaryAgent: "conversation",
            reason: "Contextual follow-up requesting explanation, clarification, or example on previous dialogue topic.",
            targetAgents: ["conversation"],
            confidence: 0.98
        };
    }

    // E. Subsystem Tools: Email, Git, Clockwork, Goals
    if (/\b(send\s+(?:an?\s+|the\s+|me\s+an?\s+)?(?:email|mail)|email\s+to|mail\s+to|smtp|send_email|email\s+report|send\s+(?:it\s+)?to\s+[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/i.test(lower) || (lower.includes("@") && lower.includes("send"))) {
        return {
            intent: "GENERAL_TOOL",
            primaryAgent: "conversation",
            reason: "Email action detected; routing to autonomous tool execution pipeline with send_email_report.",
            targetAgents: ["conversation"],
            confidence: 0.95
        };
    }

    if (GENERAL_TOOL_PATTERNS.some(p => p.test(lower))) {
        return {
            intent: "GENERAL_TOOL",
            primaryAgent: "conversation",
            reason: "Subsystem tool requested; routing via autonomous tool execution pipeline.",
            targetAgents: ["conversation"],
            confidence: 0.95
        };
    }

    // F. Multi-Agent Swarm Detection
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

    // G. Pure Code Generation Request
    if (actualCodeIntent && !hasResearchIntent && !hasBrowserIntent) {
        return {
            intent: "CODING_ONLY",
            primaryAgent: "coding",
            reason: "User requested code generation or sandbox execution; routing to CodingSubAgent.",
            targetAgents: ["coding"],
            confidence: 0.95
        };
    }

    // H. Pure Web Browsing Request
    if (hasBrowserIntent && !actualCodeIntent && !hasResearchIntent) {
        return {
            intent: "BROWSER_ONLY",
            primaryAgent: "browser",
            reason: "User requested visiting or scraping a web URL/documentation; routing to BrowserSubAgent.",
            targetAgents: ["browser"],
            confidence: 0.95
        };
    }

    // I. Explicit Web Research Request (real-time facts, 2026 events, citations, web lookup)
    if (hasResearchIntent && !actualCodeIntent && !hasBrowserIntent) {
        return {
            intent: "RESEARCH_ONLY",
            primaryAgent: "research",
            reason: "User requested live web research, current news, or external citations; routing to ResearchSubAgent.",
            targetAgents: ["research"],
            confidence: 0.95
        };
    }

    // J. Educational / Conceptual / General Knowledge Questions
    // e.g. "Explain machine learning in simple words", "What is photosynthesis?", "How does quicksort work?"
    // These are conceptual educational questions that an LLM explains directly and conversationally
    // without requiring Tavily web scraping or rigid research synthesis templates.
    const isEducationalExplanation = /^(?:explain|can you explain|how does|how do|what is|what are|why does|why do|why is|tell me about|teach me|describe|define)\b/i.test(trimmed) &&
        !hasResearchIntent && !hasBrowserIntent && !actualCodeIntent;

    if (isEducationalExplanation) {
        const isPersonalFactQuery = /\b(?:my|saved\s+facts?|my\s+notes?|remember\s+about\s+me|about\s+myself)\b/i.test(lower) ||
            /\b(?:what|where|who|which)\s+(?:am\s+i|did\s+i\s+(?:say|tell|ask|save|store))\b/i.test(lower);
        if (isPersonalFactQuery) {
            return {
                intent: "MEMORY_ONLY",
                primaryAgent: "memory",
                reason: "Personal fact/memory query routed to MemorySubAgent.",
                targetAgents: ["memory"],
                confidence: 0.95
            };
        }

        return {
            intent: "CONVERSATION",
            primaryAgent: "conversation",
            reason: "Conceptual educational explanation request; routing to ConversationSubAgent for clear, accessible direct explanation.",
            targetAgents: ["conversation"],
            confidence: 0.96
        };
    }

    // Default to ConversationSubAgent with mandatory conversationContextTool
    return {
        intent: "CONVERSATION",
        primaryAgent: "conversation",
        reason: "Standard interaction routed to ConversationSubAgent with get_conversation_context tool.",
        targetAgents: ["conversation"],
        confidence: 0.85
    };
}

/**
 * Asynchronous Intent Classification Router
 * Evaluates deterministic fast-path first. If confidence < 0.95 (e.g. nuanced query or varied wording),
 * consults ModelRouter with strict schema validation and a short timeout.
 */
export async function classifyUserIntentAsync(
    input: string, 
    contextTurns?: Array<{ user: string; bot?: string } | string>
): Promise<IntentDecision> {
    const fastDecision = classifyUserIntent(input, contextTurns);

    // High confidence deterministic fast-path
    if (fastDecision.confidence >= 0.95) {
        return fastDecision;
    }

    // If query is an empty string or pure greeting, no need to query LLM
    const trimmed = input.trim();
    if (!trimmed || CONVERSATIONAL_PATTERNS.some(p => p.test(trimmed))) {
        return fastDecision;
    }

    // Ambiguous, varied wording, or nuanced query: use ModelRouter LLM-based intent decision
    try {
        const { ModelRouter } = await import("./router");
        const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
        const router = ModelRouter.getInstance();

        const contextSnippet = contextTurns && contextTurns.length > 0
            ? "\nRecent Conversation History:\n" + contextTurns.slice(-4).map((t, idx) => {
                const u = typeof t === "string" ? t : (t.user || "");
                const b = typeof t === "string" ? "" : (t.bot || "");
                return `Turn ${idx + 1}:\nUser: ${u}\nAssistant: ${b ? b.slice(0, 160) + "..." : ""}`;
            }).join("\n\n")
            : "";

        const systemPrompt = `You are the Intent Classification Router for OpenClaw Echo AI agent.
Analyze the user message in the context of recent conversation history to determine the optimal intent and primary subagent.

Available Intents & Agents:
1. "CONVERSATION" (Agent: "conversation"):
   - Educational or conceptual explanations (e.g. "Explain machine learning in simple words", "How does gravity work?", "What is polymorphism?").
   - Follow-up questions, elaboration, requests for examples, or clarification on earlier discussion (e.g. "Can you explain that with an example?", "Tell me more", "Why is that?").
   - Conversational greetings, identity inquiries ("Who are you?"), polite pleasantries, general Q&A.

2. "RESEARCH_ONLY" (Agent: "research"):
   - Queries requiring live web search, current 2026 events, latest news, market prices, or real-time online documentation.
   - Explicit user requests to search the web, conduct research, or find external source citations.

3. "CODING_ONLY" (Agent: "coding"):
   - Requests to write, implement, modify, debug, or execute code, scripts, or sandbox files.

4. "BROWSER_ONLY" (Agent: "browser"):
   - Explicit URLs (http/https), requests to visit, scrape, or inspect a specific website or online documentation.

5. "MEMORY_ONLY" (Agent: "memory"):
   - User asking about their own personal profile, saved facts ("remember that...", "what did I say my name was?"), or past questions.

6. "GENERAL_TOOL" (Agent: "conversation"):
   - Subsystem commands: sending emails, git commands, scheduling tasks, project goals.

7. "MULTI_AGENT" (Agent: "planner"):
   - Multi-step tasks requiring coordinating research + code generation + verification.

Context Guidelines:
- If the user's message is a follow-up or request for examples (e.g. "Can you explain that with an example?"), maintain conversation continuity under CONVERSATION unless explicit coding or web search is requested.

Output STRICT JSON only:
{"intent": "CONVERSATION", "primaryAgent": "conversation", "confidence": 0.95, "reason": "concise explanation"}`;

        const timeoutPromise = new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error("INTENT_ROUTER_TIMEOUT")), 2500);
        });

        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(`User Message: "${input}"${contextSnippet}`)
        ];

        const response: any = await Promise.race([
            router.invoke(messages, "intent_classifier"),
            timeoutPromise
        ]);

        const rawContent = response?.content ? String(response.content) : "";
        const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const validIntents: UserIntent[] = ["CONVERSATION", "RESEARCH_ONLY", "BROWSER_ONLY", "CODING_ONLY", "MEMORY_ONLY", "MULTI_AGENT", "GENERAL_TOOL"];
            const validAgents: TargetAgentType[] = ["conversation", "research", "browser", "coding", "memory", "planner"];

            if (validIntents.includes(parsed.intent) && validAgents.includes(parsed.primaryAgent)) {
                return {
                    intent: parsed.intent,
                    primaryAgent: parsed.primaryAgent,
                    reason: parsed.reason || "Classified via semantic ModelRouter intent engine.",
                    targetAgents: [parsed.primaryAgent],
                    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.95
                };
            }
        }
    } catch (e: any) {
        // Fall back gracefully to deterministic fast decision on timeout or error
    }

    return fastDecision;
}
