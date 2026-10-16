import * as fs from "fs/promises";
import * as path from "path";
import { isSimpleConversation } from "../src/core/conversationGuard";
import { ToolSelector } from "../src/core/toolSelector";

export interface LabeledPrompt {
    id: number;
    prompt: string;
    expectedPath: "fast" | "tool";
    expectedCategory: string;
    isHeldOut: boolean;
}

export interface RoutingEvaluationResult {
    totalPrompts: number;
    devPrompts: number;
    heldOutPrompts: number;
    devAccuracy: number;
    heldOutAccuracy: number;
    combinedAccuracy: number;
    devConfusionMatrix: { tp: number; fp: number; tn: number; fn: number };
    heldOutConfusionMatrix: { tp: number; fp: number; tn: number; fn: number };
    combinedConfusionMatrix: { tp: number; fp: number; tn: number; fn: number };
    misclassifications: Array<{
        id: number;
        prompt: string;
        expectedPath: string;
        actualPath: string;
        expectedCategory: string;
        actualCategory: string;
        isHeldOut: boolean;
    }>;
}

// 100 Development Prompts
const DEV_PROMPTS: Omit<LabeledPrompt, "id" | "isHeldOut">[] = [
    // Greetings & Smalltalk (fast)
    { prompt: "hi", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "hello", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "hey", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Hello there!", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Good morning", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Good evening", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "How are you doing today?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Who are you?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "What is your name?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Tell me a joke", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Are you an AI assistant?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Thank you so much", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Thanks a lot", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Goodbye", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "See you later", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "What can you do?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Nice to meet you", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Tell me something interesting", expectedPath: "fast", expectedCategory: "fast_path" },

    // Simple Arithmetic (fast)
    { prompt: "2+2", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "what is 15 * 4?", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "calculate 100 / 5", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "50 - 25", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "12 * 12", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "what is 99 + 1?", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "calculate 300 / 3", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "sqrt(144)", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "25 + 75", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "10 * 10", expectedPath: "fast", expectedCategory: "calculation" },

    // Substring Traps (must NOT trigger tool path if pure conversation)
    { prompt: "this is awesome", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "I think you are helpful", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "what is the history of chess?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "this computer is fast", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "I like this idea", expectedPath: "fast", expectedCategory: "fast_path" },

    // Code Execution (tool)
    { prompt: "Run this JavaScript: console.log(2+2)", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Execute script math.js in sandbox", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "run the code inside run.js", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "run_sandbox_code on test.js", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "execute javascript to compute prime numbers", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "evaluate this code: console.log('hello')", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Run this python script", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "write_sandbox_file and run_sandbox_code", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "synthesize_skill to add two matrices", expectedPath: "tool", expectedCategory: "delegation" },
    { prompt: "synthesize a new tool named word_counter", expectedPath: "tool", expectedCategory: "delegation" },

    // Goals & Milestones (tool)
    { prompt: "Add a goal: finish testing", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "What are my goals?", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "My goals", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "List all project goals", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Add a milestone: deploy to production", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "What are the project objectives?", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Show my goals list", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "manage_project_goals list", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Remove goal finish testing", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Update goal status to completed", expectedPath: "tool", expectedCategory: "goals" },

    // Saved Facts & Memory (tool)
    { prompt: "Remember that my favorite color is teal", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "What is my favorite color?", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "Recall my saved facts", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "search_memory for architecture notes", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "Store fact user_profile timezone is UTC+5", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "What do you know about my profile?", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "get_all_knowledge from memory", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "search memory for recent discussions", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "check saved facts in memory store", expectedPath: "tool", expectedCategory: "memory" },

    // File Operations & Sandbox (tool)
    { prompt: "Create a file named notes.txt", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Write file summary.md containing analysis", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Read file notes.txt in sandbox", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Delete file temp.txt", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "List files in the sandbox directory", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Check sandbox folder contents", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Save data to data.json", expectedPath: "tool", expectedCategory: "file_system" },

    // Email & Notifications (tool)
    { prompt: "Send email to team@example.com", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Send email report with subject Status Update", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Dispatch an smtp alert to the manager", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Email the daily synopsis to owner", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Send mail regarding release v2", expectedPath: "tool", expectedCategory: "email" },

    // Git & Version Control (tool)
    { prompt: "Check git status", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "Show git log for the last 5 commits", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "What git branch am I currently on?", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "Inspect git repo differences", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "Show git commit history", expectedPath: "tool", expectedCategory: "git" },

    // Scheduling & Cron (tool)
    { prompt: "Schedule a task to run daily at 9am", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "List all scheduled tasks", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "Set a reminder timer for 15 minutes", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "Create a recurring cron schedule", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "Cancel scheduled task task_123", expectedPath: "tool", expectedCategory: "schedule" },

    // Web Search & Scraping (tool)
    { prompt: "Search web for recent AI research papers", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Google the release date of TypeScript 5.8", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Scrape content from https://example.com", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Browse the web for latest tech news", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Fetch URL https://news.ycombinator.com", expectedPath: "tool", expectedCategory: "search_web" },

    // Architecture & Diagnostics (tool)
    { prompt: "visualize architecture of the system", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "generate project manual", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "run system audit on current codebase", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "generate data chart for monthly revenue", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "delegate task to research agent", expectedPath: "tool", expectedCategory: "delegation" },
    { prompt: "get memory statistics", expectedPath: "tool", expectedCategory: "memory" },

    // Tricky cases: Substring traps ("this") and Synonyms ("objectives", "aims")
    { prompt: "What is this?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Can you review this explanation?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Is this assumption accurate?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "What are my current objectives?", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "List my quarterly objectives and aims", expectedPath: "tool", expectedCategory: "goals" }
];

// 50 Held-Out Prompts (written naturally representing unseen variations)
const HELD_OUT_PROMPTS: Omit<LabeledPrompt, "id" | "isHeldOut">[] = [
    // Conversational & questions (fast)
    { prompt: "Hey buddy how's your day going?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Can you tell me a good bedtime story?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Who invented the telephone?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "What is the capital of Australia?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "I appreciate your assistance", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "See ya later alligator", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Hi there, hope you are having fun", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Can you explain what quantum computing is?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "Why is the sky blue?", expectedPath: "fast", expectedCategory: "fast_path" },
    { prompt: "You are doing great", expectedPath: "fast", expectedCategory: "fast_path" },

    // Calculations (fast)
    { prompt: "what is 200 * 4", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "calculate 144 / 12", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "33 + 67", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "what is 500 - 150?", expectedPath: "fast", expectedCategory: "calculation" },
    { prompt: "calculate 8 * 9", expectedPath: "fast", expectedCategory: "calculation" },

    // Code execution requests (tool)
    { prompt: "Please run this JS code: console.log('testing')", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Can you execute this script to compute primes?", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Run JavaScript code to format the JSON string", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Execute the file script.js in our sandbox", expectedPath: "tool", expectedCategory: "code_execution" },
    { prompt: "Evaluate the javascript expression 2 ** 10", expectedPath: "tool", expectedCategory: "code_execution" },

    // Goals requests (tool)
    { prompt: "Add new goal: prepare slides for Thursday", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "What project goals have I defined so far?", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "List my active milestones please", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Do I have any goals set for this week?", expectedPath: "tool", expectedCategory: "goals" },
    { prompt: "Add milestone: ship beta release to users", expectedPath: "tool", expectedCategory: "goals" },

    // Memory & Knowledge requests (tool)
    { prompt: "Please remember that I am an engineer from Cairo", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "What city did I tell you I was from?", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "Recall the project notes from our previous meeting", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "Search memory for database credentials discussion", expectedPath: "tool", expectedCategory: "memory" },
    { prompt: "Save fact preference editor VSCode", expectedPath: "tool", expectedCategory: "memory" },

    // File operations (tool)
    { prompt: "Create a new file named audit_summary.txt", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Read the file configuration.json from the sandbox", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Write file checklist.txt with items 1 2 3", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "List files inside the sandbox folder", expectedPath: "tool", expectedCategory: "file_system" },
    { prompt: "Remove old file test_run.log", expectedPath: "tool", expectedCategory: "file_system" },

    // Email (tool)
    { prompt: "Send an email update to roqaiah@example.com", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Please email the quarterly findings to the lead", expectedPath: "tool", expectedCategory: "email" },
    { prompt: "Dispatch an urgent mail regarding system downtime", expectedPath: "tool", expectedCategory: "email" },

    // Git (tool)
    { prompt: "Show git status of the project", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "Check recent commits on the current branch in git", expectedPath: "tool", expectedCategory: "git" },
    { prompt: "Can you run git diff to see recent changes?", expectedPath: "tool", expectedCategory: "git" },

    // Scheduling (tool)
    { prompt: "Schedule a reminder to stretch every 2 hours", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "What tasks are currently scheduled on cron?", expectedPath: "tool", expectedCategory: "schedule" },
    { prompt: "Set a timer for 30 minutes to review code", expectedPath: "tool", expectedCategory: "schedule" },

    // Search & scrape (tool)
    { prompt: "Search web for LangChain LangGraph comparison", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Scrape the webpage https://docs.github.com", expectedPath: "tool", expectedCategory: "search_web" },
    { prompt: "Google the weather forecast in Tokyo", expectedPath: "tool", expectedCategory: "search_web" },

    // System Meta (tool)
    { prompt: "Visualize architecture of our agent pipeline", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "Generate project manual documentation", expectedPath: "tool", expectedCategory: "system_meta" },
    { prompt: "Delegate task to coding agent to write a parser", expectedPath: "tool", expectedCategory: "delegation" }
];

export async function evaluateRouting(): Promise<RoutingEvaluationResult> {
    const allPrompts: LabeledPrompt[] = [
        ...DEV_PROMPTS.map((p, idx) => ({ ...p, id: idx + 1, isHeldOut: false })),
        ...HELD_OUT_PROMPTS.map((p, idx) => ({ ...p, id: DEV_PROMPTS.length + idx + 1, isHeldOut: true }))
    ];

    let devCorrect = 0;
    let heldOutCorrect = 0;
    const devCM = { tp: 0, fp: 0, tn: 0, fn: 0 };
    const heldOutCM = { tp: 0, fp: 0, tn: 0, fn: 0 };
    const combinedCM = { tp: 0, fp: 0, tn: 0, fn: 0 };
    const misclassifications: RoutingEvaluationResult["misclassifications"] = [];

    const csvRows: string[] = [
        "id,is_held_out,prompt,expected_path,predicted_path,path_correct,expected_category,predicted_category,category_correct,tool_count"
    ];

    for (const item of allPrompts) {
        // Evaluate conversation guard (fast-path vs tool-path)
        const isSimple = isSimpleConversation(item.prompt);
        const predictedPath: "fast" | "tool" = isSimple ? "fast" : "tool";
        const pathCorrect = predictedPath === item.expectedPath;

        // Evaluate tool selector
        const toolSelection = ToolSelector.selectTools(item.prompt);
        const predictedCategory = isSimple ? "fast_path" : toolSelection.category;

        // Update confusion matrices
        // Positive = "tool", Negative = "fast"
        const isToolExpected = item.expectedPath === "tool";
        const isToolPredicted = predictedPath === "tool";

        if (isToolExpected && isToolPredicted) {
            combinedCM.tp++;
            if (item.isHeldOut) heldOutCM.tp++; else devCM.tp++;
        } else if (!isToolExpected && !isToolPredicted) {
            combinedCM.tn++;
            if (item.isHeldOut) heldOutCM.tn++; else devCM.tn++;
        } else if (!isToolExpected && isToolPredicted) {
            combinedCM.fp++;
            if (item.isHeldOut) heldOutCM.fp++; else devCM.fp++;
        } else if (isToolExpected && !isToolPredicted) {
            combinedCM.fn++;
            if (item.isHeldOut) heldOutCM.fn++; else devCM.fn++;
        }

        if (pathCorrect) {
            if (item.isHeldOut) heldOutCorrect++;
            else devCorrect++;
        } else {
            misclassifications.push({
                id: item.id,
                prompt: item.prompt,
                expectedPath: item.expectedPath,
                actualPath: predictedPath,
                expectedCategory: item.expectedCategory,
                actualCategory: predictedCategory,
                isHeldOut: item.isHeldOut
            });
        }

        const safePromptCsv = `"${item.prompt.replace(/"/g, '""')}"`;
        csvRows.push([
            item.id,
            item.isHeldOut ? 1 : 0,
            safePromptCsv,
            item.expectedPath,
            predictedPath,
            pathCorrect ? 1 : 0,
            item.expectedCategory,
            predictedCategory,
            predictedCategory.includes(item.expectedCategory) ? 1 : 0,
            toolSelection.tools.length
        ].join(","));
    }

    const devTotal = DEV_PROMPTS.length;
    const heldOutTotal = HELD_OUT_PROMPTS.length;
    const combinedTotal = allPrompts.length;

    const devAccuracy = (devCorrect / devTotal) * 100;
    const heldOutAccuracy = (heldOutCorrect / heldOutTotal) * 100;
    const combinedAccuracy = ((devCorrect + heldOutCorrect) / combinedTotal) * 100;

    // Save raw results to CSV
    const csvPath = path.resolve("eval/results/routing_results.csv");
    await fs.writeFile(csvPath, csvRows.join("\n"), "utf-8");

    return {
        totalPrompts: combinedTotal,
        devPrompts: devTotal,
        heldOutPrompts: heldOutTotal,
        devAccuracy,
        heldOutAccuracy,
        combinedAccuracy,
        devConfusionMatrix: devCM,
        heldOutConfusionMatrix: heldOutCM,
        combinedConfusionMatrix: combinedCM,
        misclassifications
    };
}

if (require.main === module) {
    evaluateRouting().then(res => {
        console.log("=== ROUTING EVALUATION RESULTS ===");
        console.log(`Dev Accuracy (N=${res.devPrompts}): ${res.devAccuracy.toFixed(2)}%`);
        console.log(`Held-Out Accuracy (N=${res.heldOutPrompts}): ${res.heldOutAccuracy.toFixed(2)}%`);
        console.log(`Combined Accuracy (N=${res.totalPrompts}): ${res.combinedAccuracy.toFixed(2)}%`);
        console.log(`Dev Confusion Matrix:`, JSON.stringify(res.devConfusionMatrix));
        console.log(`Held-Out Confusion Matrix:`, JSON.stringify(res.heldOutConfusionMatrix));
        console.log(`Combined Confusion Matrix:`, JSON.stringify(res.combinedConfusionMatrix));
        console.log(`Misclassifications Count: ${res.misclassifications.length}`);
    }).catch(err => {
        console.error("Routing evaluation error:", err);
        process.exit(1);
    });
}
