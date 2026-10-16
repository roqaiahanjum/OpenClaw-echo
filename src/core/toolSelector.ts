import { SkillRegistry } from "../skills/registry";
import { isSimpleConversation } from "./conversationGuard";

export interface ToolSelectionResult {
    tools: any[];
    category: string;
    tokenEstimate: number;
    reason: string;
}

/**
 * Domain-specific tool mappings.
 * Categorizes the 23 tools into targeted functional domains to prevent
 * schema bloat and preserve LLM token limits (especially Groq 8,000 TPM).
 */
const TOOL_DOMAINS: Record<string, { toolNames: string[]; keywords: RegExp }> = {
    code_execution: {
        toolNames: ["write_sandbox_file", "run_sandbox_code"],
        keywords: /\b(run|execute|exec|eval|javascript|js|typescript|ts|python|py|script|code|sandbox|console\.log)\b/i
    },
    goals: {
        toolNames: ["manage_project_goals"],
        keywords: /\b(goals?|milestones?|objectives?|project goals?)\b/i
    },
    calculation: {
        toolNames: ["run_sandbox_code"],
        keywords: /\b(calc|calculate|calculation|calculator|math|compute|eval|solve|equation|formula|multiply|divide|subtract|\+|\-|\*|\/|\^|%|sqrt|fibonacci|prime|factorial)\b/i
    },
    web_research: {
        toolNames: ["web_search", "scrape_website"],
        keywords: /\b(search|web|google|news|weather|online|browse|scrape|url|http|https|website|article|latest|who is|current events)\b/i
    },
    file_system: {
        toolNames: ["local_file_system", "write_sandbox_file"],
        keywords: /\b(file|files|folder|directory|sandbox|read file|write file|save file|list files|inspect|create file|delete file|path)\b/i
    },
    git: {
        toolNames: ["manage_git_repository"],
        keywords: /\b(git|commits?|branch(?:es)?|repos?|repository|git\s+status|git\s+diff|git\s+log|staging|checkout)\b/i
    },
    memory: {
        toolNames: ["save_knowledge", "get_all_knowledge", "search_memory", "get_memory_stats", "update_user_profile"],
        keywords: /\b(memory|remember|recall|fact|facts|saved facts?|store fact|user profile|preference|preferences|my name is|forget|what do you know|knowledge)\b/i
    },
    clockwork: {
        toolNames: ["manage_scheduled_tasks"],
        keywords: /\b(schedule|schedules|scheduled|clockwork|cron|timer|periodic|recurring|every minute|every hour|interval)\b/i
    },
    system_audit: {
        toolNames: ["run_system_audit", "visualize_architecture", "generate_data_chart", "generate_project_manual"],
        keywords: /\b(audit|health|diagnose|architecture|diagram|mermaid|chart|plot|graph|manual|system state)\b/i
    },
    delegation: {
        toolNames: ["delegate_task", "synthesize_skill", "manage_project_goals"],
        keywords: /\b(delegate|subagent|sub-agent|worker|milestone|project goal|synthesize skill|new skill)\b/i
    },
    email: {
        toolNames: ["send_email_report"],
        keywords: /\b(email|mail|send email|smtp|email report)\b/i
    },
    time: {
        toolNames: ["get_current_time"],
        keywords: /\b(what time|current time|what is the time|today's date|current date|what day is it|clock)\b/i
    }
};

/**
 * Compact core toolkit used when an action query does not strictly match a single domain.
 * Total tokens: ~1,500 (well within Groq's 8,000 TPM limit).
 */
const DEFAULT_CORE_TOOLS = ["web_search", "local_file_system", "run_sandbox_code", "search_memory", "manage_project_goals"];

export class ToolSelector {
    /**
     * Determines required capabilities from the user prompt and returns only relevant tool schemas.
     */
    static selectTools(prompt: string): ToolSelectionResult {
        const trimmed = prompt.trim();

        // 1. Identify all matching domains first
        const matchedToolNames = new Set<string>();
        const matchedDomains: string[] = [];

        for (const [domain, config] of Object.entries(TOOL_DOMAINS)) {
            if (config.keywords.test(trimmed)) {
                matchedDomains.push(domain);
                config.toolNames.forEach(name => matchedToolNames.add(name));
            }
        }

        // 2. If specific domains matched, load only those tools
        if (matchedToolNames.size > 0) {
            const selectedTools = Array.from(matchedToolNames)
                .map(name => SkillRegistry.getToolByName(name))
                .filter(Boolean);

            const tokenEstimate = selectedTools.length * 360;

            return {
                tools: selectedTools,
                category: matchedDomains.join("+"),
                tokenEstimate,
                reason: `Matched domain(s): ${matchedDomains.join(", ")} (${selectedTools.length} tools loaded).`
            };
        }

        // 3. Conversational Fast-Path (0 tools needed when no domain tools matched)
        if (isSimpleConversation(trimmed)) {
            return {
                tools: [],
                category: "conversational",
                tokenEstimate: 0,
                reason: "Conversational greeting or direct question requires no external tools."
            };
        }

        // 4. Fallback for unclassified queries requiring capabilities: Load compact core set
        const coreTools = DEFAULT_CORE_TOOLS
            .map(name => SkillRegistry.getToolByName(name))
            .filter(Boolean);

        return {
            tools: coreTools,
            category: "core_default",
            tokenEstimate: coreTools.length * 360,
            reason: `Unclassified action query: loaded compact core toolkit (${coreTools.length} tools).`
        };
    }
}
