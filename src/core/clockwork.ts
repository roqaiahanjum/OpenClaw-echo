import * as fs from "fs/promises";
import * as path from "path";

export interface ScheduledTask {
    id: string;
    name: string;
    description: string;
    intervalMs: number;
    prompt: string;
    enabled: boolean;
    lastRun: string | null;
    createdAt: string;
}

/**
 * Clockwork: Autonomous Scheduled Task Engine
 * Manages persistent recurring jobs for the agent.
 */
export class Clockwork {
    private static storagePath = path.join(path.resolve("src/sandbox"), "schedules.json");
    private static timers: Map<string, NodeJS.Timeout> = new Map();
    private static executeCallback: ((prompt: string) => Promise<void>) | null = null;

    static setExecutor(callback: (prompt: string) => Promise<void>) {
        this.executeCallback = callback;
    }

    private static async loadTasks(): Promise<ScheduledTask[]> {
        try {
            const data = await fs.readFile(this.storagePath, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    private static async saveTasks(tasks: ScheduledTask[]) {
        await fs.writeFile(this.storagePath, JSON.stringify(tasks, null, 2), "utf-8");
    }

    static async createTask(name: string, description: string, intervalMs: number, prompt: string): Promise<ScheduledTask> {
        const tasks = await this.loadTasks();
        const task: ScheduledTask = {
            id: `sched_${Date.now()}`,
            name,
            description,
            intervalMs,
            prompt,
            enabled: true,
            lastRun: null,
            createdAt: new Date().toISOString()
        };
        tasks.push(task);
        await this.saveTasks(tasks);
        this.startTimer(task);
        console.log(`[Clockwork] Scheduled: "${name}" every ${intervalMs / 1000}s`);
        return task;
    }

    static async listTasks(): Promise<ScheduledTask[]> {
        return this.loadTasks();
    }

    static async toggleTask(taskId: string, enabled: boolean): Promise<ScheduledTask | null> {
        const tasks = await this.loadTasks();
        const task = tasks.find(t => t.id === taskId);
        if (!task) return null;

        task.enabled = enabled;
        await this.saveTasks(tasks);

        if (enabled) {
            this.startTimer(task);
        } else {
            this.stopTimer(taskId);
        }
        return task;
    }

    static async deleteTask(taskId: string): Promise<boolean> {
        const tasks = await this.loadTasks();
        const idx = tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return false;

        this.stopTimer(taskId);
        tasks.splice(idx, 1);
        await this.saveTasks(tasks);
        return true;
    }

    private static startTimer(task: ScheduledTask) {
        this.stopTimer(task.id); // Clear existing if any

        const timer = setInterval(async () => {
            if (!this.executeCallback) return;
            console.log(`[Clockwork] Executing scheduled task: ${task.name}`);
            try {
                await this.executeCallback(task.prompt);
                // Update lastRun
                const tasks = await this.loadTasks();
                const t = tasks.find(tt => tt.id === task.id);
                if (t) {
                    t.lastRun = new Date().toISOString();
                    await this.saveTasks(tasks);
                }
            } catch (err: any) {
                console.error(`[Clockwork] Task "${task.name}" failed:`, err.message);
            }
        }, task.intervalMs);

        this.timers.set(task.id, timer);
    }

    private static stopTimer(taskId: string) {
        const existing = this.timers.get(taskId);
        if (existing) {
            clearInterval(existing);
            this.timers.delete(taskId);
        }
    }

    /** Boot: Reload and restart all enabled scheduled tasks */
    static async boot() {
        const tasks = await this.loadTasks();
        const enabled = tasks.filter(t => t.enabled);
        for (const task of enabled) {
            this.startTimer(task);
        }
        if (enabled.length > 0) {
            console.log(`[Clockwork] Booted ${enabled.length} scheduled task(s).`);
        }
    }
}
