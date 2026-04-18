import { ModelRouter } from "./router";

export type AgentRole = "Researcher" | "Coder" | "Analyst" | "Writer" | "QA_Engineer";

const ROLE_PROMPTS: Record<AgentRole, string> = {
    Researcher: "You are the Swarm's Deep Researcher Sub-Agent. Your task is to investigate the given topic thoroughly, extract facts, and provide a dense summary. Do not use conversational filler.",
    Coder: "You are the Swarm's Coder Sub-Agent. Your task is to write clean, optimized, production-ready code for the given prompt. Only return the code and brief instructions.",
    Analyst: "You are the Swarm's Data Analyst Sub-Agent. Your task is to analyze the provided data, identify trends, and format the output logically for the Manager.",
    Writer: "You are the Swarm's Writer Sub-Agent. Your task is to draft high-quality, engaging content based on the raw information provided.",
    QA_Engineer: "You are the Swarm's Quality Assurance Sub-Agent. Your task is to review code or project plans for vulnerabilities, logical flaws, edge cases, and performance bottlenecks. Provide a strict, detailed bug-report."
};

/**
 * SwarmOrchestrator
 * Allows the primary (Manager) agent to delegate tasks to specialized sub-agents.
 */
export class SwarmOrchestrator {
    static async delegateTask(role: AgentRole, taskDescription: string): Promise<string> {
        try {
            console.log(`[Swarm] Spawning ${role} Sub-Agent to process: ${taskDescription}`);
            
            // Sub-agents get a highly specialized system prompt
            const specializedPrompt = ROLE_PROMPTS[role];
            
            // Construct a mini-history just for this sub-task execution
            const taskHistory = [
                { role: "system", content: specializedPrompt },
                { role: "user", content: `TASK FROM MANAGER: ${taskDescription}` }
            ];

            // Sub-agents run with the cloud model for maximum comprehension
            const response = await ModelRouter.invoke(taskHistory, "gemini");
            
            console.log(`[Swarm] ${role} Sub-Agent completed task.`);
            return `--- SUB-AGENT REPORT (${role}) ---\n${response}\n--- END REPORT ---`;
        } catch (error: any) {
            console.error(`[Swarm] ${role} Sub-Agent failed:`, error);
            return `Sub-Agent ${role} encountered an error: ${error.message}`;
        }
    }
}
