import * as fs from "fs/promises";
import * as path from "path";

export interface Goal {
    id: string;
    title: string;
    description: string;
    status: "active" | "completed" | "failed";
    progress: number;
    subtasks: { id: string, title: string, completed: boolean }[];
    createdAt: string;
    updatedAt: string;
}

/**
 * GoalManager (The Oracle)
 * Manages persistent long-term objectives for the agent.
 */
export class GoalManager {
    private storagePath: string = path.join(path.resolve("src/sandbox"), "goals.json");

    constructor() {
        this.initStorage();
    }

    private async initStorage() {
        try {
            await fs.access(this.storagePath);
        } catch {
            await this.saveGoals([]);
        }
    }

    private async getGoals(): Promise<Goal[]> {
        try {
            const data = await fs.readFile(this.storagePath, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    private async saveGoals(goals: Goal[]) {
        try {
            await fs.writeFile(this.storagePath, JSON.stringify(goals, null, 2), "utf-8");
        } catch (error: any) {
            console.error("[Oracle] Failed to save goals:", error.message);
        }
    }

    async createGoal(title: string, description: string, subtaskTitles: string[] = []): Promise<Goal> {
        const goals = await this.getGoals();
        const newGoal: Goal = {
            id: `goal_${Date.now()}`,
            title,
            description,
            status: "active",
            progress: 0,
            subtasks: subtaskTitles.map((t, i) => ({ id: `sub_${i}`, title: t, completed: false })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        goals.push(newGoal);
        await this.saveGoals(goals);
        return newGoal;
    }

    async updateGoalProgress(goalId: string, progress: number, status?: "active" | "completed" | "failed"): Promise<Goal | null> {
        const goals = await this.getGoals();
        const goalIndex = goals.findIndex(g => g.id === goalId);
        
        if (goalIndex === -1) return null;

        goals[goalIndex].progress = progress;
        if (status) goals[goalIndex].status = status;
        goals[goalIndex].updatedAt = new Date().toISOString();

        await this.saveGoals(goals);
        return goals[goalIndex];
    }

    async updateSubtask(goalId: string, subtaskId: string, completed: boolean): Promise<Goal | null> {
        const goals = await this.getGoals();
        const goalIndex = goals.findIndex(g => g.id === goalId);
        
        if (goalIndex === -1) return null;

        const subtask = goals[goalIndex].subtasks.find(s => s.id === subtaskId);
        if (subtask) {
            subtask.completed = completed;
            
            // Auto-recalculate progress
            const total = goals[goalIndex].subtasks.length;
            const done = goals[goalIndex].subtasks.filter(s => s.completed).length;
            goals[goalIndex].progress = total > 0 ? Math.round((done / total) * 100) : goals[goalIndex].progress;
            
            if (goals[goalIndex].progress === 100) {
                goals[goalIndex].status = "completed";
            }
            
            goals[goalIndex].updatedAt = new Date().toISOString();
            await this.saveGoals(goals);
        }

        return goals[goalIndex];
    }

    async getAllGoals(): Promise<Goal[]> {
        return this.getGoals();
    }

    async getActiveGoals(): Promise<Goal[]> {
        const goals = await this.getGoals();
        return goals.filter(g => g.status === "active");
    }
}
