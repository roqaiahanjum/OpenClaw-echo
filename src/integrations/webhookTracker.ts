import { DatabaseConnectionFactory, IDatabaseConnection } from "../memory/dbAdapter";

export interface WebhookUpdateRecord {
    update_id: number;
    chat_id: string;
    payload: string;
    status: "pending" | "processing" | "completed" | "failed";
    attempts: number;
    created_at: string;
    updated_at: string;
    error?: string;
}

export type WebhookAction = 
    | { action: "PROCESS" }
    | { action: "SKIP"; reason: "ALREADY_COMPLETED" | "IN_FLIGHT" | "MAX_ATTEMPTS_EXCEEDED" }
    | { action: "ERROR"; error: string };

function parseUtcTimestamp(ts: string): number {
    if (!ts) return 0;
    const iso = ts.includes("T") ? (ts.endsWith("Z") ? ts : `${ts}Z`) : `${ts.replace(" ", "T")}Z`;
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? 0 : ms;
}

export class WebhookTracker {
    private static instance: WebhookTracker;
    private isInitialized: boolean = false;

    private get db(): IDatabaseConnection {
        return DatabaseConnectionFactory.getConnection();
    }

    public static getInstance(): WebhookTracker {
        if (!WebhookTracker.instance) {
            WebhookTracker.instance = new WebhookTracker();
        }
        return WebhookTracker.instance;
    }

    public static resetInstance(): void {
        WebhookTracker.instance = undefined as any;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
                update_id INTEGER PRIMARY KEY,
                chat_id TEXT DEFAULT 'default',
                payload TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                attempts INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                error TEXT
            )
        `);
        await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_webhook_status ON telegram_webhook_updates(status)`).catch(() => {});
        this.isInitialized = true;
    }

    /**
     * Inspects incoming update and records it durably in the database.
     * Prevents duplicate execution if already completed or actively processing.
     */
    public async registerIncomingUpdate(
        updateId: number, 
        chatId: string, 
        payload: any
    ): Promise<WebhookAction> {
        await this.initialize().catch(() => {});

        try {
            const existing = await this.db.get<WebhookUpdateRecord>(
                `SELECT update_id, status, attempts, updated_at FROM telegram_webhook_updates WHERE update_id = ?`,
                [updateId]
            );

            if (existing) {
                // If already completed, skip duplicate
                if (existing.status === "completed") {
                    console.log(`[WebhookTracker] Update ${updateId} already completed. Suppressing duplicate.`);
                    return { action: "SKIP", reason: "ALREADY_COMPLETED" };
                }

                // If currently processing, check lease (45 seconds)
                if (existing.status === "processing") {
                    const elapsedMs = Date.now() - parseUtcTimestamp(existing.updated_at);
                    if (elapsedMs < 45000) {
                        console.log(`[WebhookTracker] Update ${updateId} is actively in flight (${Math.round(elapsedMs / 1000)}s ago). Suppressing duplicate retry.`);
                        return { action: "SKIP", reason: "IN_FLIGHT" };
                    }
                }

                if (existing.attempts >= 3) {
                    console.warn(`[WebhookTracker] Update ${updateId} exceeded max retry attempts (${existing.attempts}). Suppressing.`);
                    return { action: "SKIP", reason: "MAX_ATTEMPTS_EXCEEDED" };
                }

                // Update attempts and lease
                await this.db.run(
                    `UPDATE telegram_webhook_updates 
                     SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP 
                     WHERE update_id = ?`,
                    [updateId]
                );
                return { action: "PROCESS" };
            }

            // New update: record durably as processing
            const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
            await this.db.run(
                `INSERT INTO telegram_webhook_updates (update_id, chat_id, payload, status, attempts, created_at, updated_at)
                 VALUES (?, ?, ?, 'processing', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [updateId, String(chatId), payloadStr]
            );

            return { action: "PROCESS" };
        } catch (err: any) {
            console.error(`[WebhookTracker] Error registering update ${updateId}:`, err.message);
            // Registration failed: return ERROR so webhook responds with HTTP 500 and Telegram retries
            return { action: "ERROR", error: err.message || "Failed to persist update durably" };
        }
    }

    public async markCompleted(updateId: number): Promise<void> {
        try {
            await this.db.run(
                `UPDATE telegram_webhook_updates 
                 SET status = 'completed', updated_at = CURRENT_TIMESTAMP, error = NULL 
                 WHERE update_id = ?`,
                [updateId]
            );
        } catch (err: any) {
            console.warn(`[WebhookTracker] Warning marking update ${updateId} completed:`, err.message);
        }
    }

    public async markFailed(updateId: number, errorMessage: string): Promise<void> {
        try {
            await this.db.run(
                `UPDATE telegram_webhook_updates 
                 SET status = 'failed', updated_at = CURRENT_TIMESTAMP, error = ? 
                 WHERE update_id = ?`,
                [errorMessage, updateId]
            );
        } catch (err: any) {
            console.warn(`[WebhookTracker] Warning marking update ${updateId} failed:`, err.message);
        }
    }

    /**
     * Startup recovery sweep:
     * Finds updates left in 'pending' or 'processing' state due to container restart/crash.
     * Prevents duplicate bot replies by checking whether the interaction was already committed.
     */
    public async recoverPendingUpdates(botInstance: any): Promise<number> {
        await this.initialize().catch(() => {});
        try {
            const staleRows = await this.db.all<WebhookUpdateRecord>(
                `SELECT update_id, chat_id, payload, attempts 
                 FROM telegram_webhook_updates 
                 WHERE status IN ('pending', 'processing') AND attempts < 3 
                 ORDER BY created_at ASC LIMIT 10`
            );

            if (!staleRows || staleRows.length === 0) {
                return 0;
            }

            console.log(`[WebhookTracker] 🔄 Found ${staleRows.length} uncompleted webhook updates from prior process crash. Recovering...`);
            let recoveredCount = 0;

            for (const row of staleRows) {
                try {
                    console.log(`[WebhookTracker] Recovering update ${row.update_id} (Attempt ${row.attempts + 1})...`);
                    const payloadObj = JSON.parse(row.payload);
                    const userText = payloadObj?.message?.text || payloadObj?.callback_query?.data;

                    // Deduplication check: Was this interaction already processed and recorded in interactions?
                    if (userText && row.chat_id) {
                        const existingInteraction = await this.db.get<{ id: string }>(
                            `SELECT id FROM interactions WHERE chat_id = ? AND user_msg = ? ORDER BY timestamp DESC LIMIT 1`,
                            [row.chat_id, userText]
                        ).catch(() => null);

                        if (existingInteraction) {
                            console.log(`[WebhookTracker] Update ${row.update_id} already has a recorded interaction in memory. Suppressing duplicate reply and marking completed.`);
                            await this.markCompleted(row.update_id);
                            recoveredCount++;
                            continue;
                        }
                    }

                    await this.db.run(
                        `UPDATE telegram_webhook_updates SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE update_id = ?`,
                        [row.update_id]
                    );

                    await botInstance.handleUpdate(payloadObj);
                    await this.markCompleted(row.update_id);
                    recoveredCount++;
                    console.log(`[WebhookTracker] ✅ Update ${row.update_id} recovered and completed successfully.`);
                } catch (recErr: any) {
                    console.error(`[WebhookTracker] Failed to recover update ${row.update_id}:`, recErr.message);
                    await this.markFailed(row.update_id, recErr.message);
                }
            }

            return recoveredCount;
        } catch (err: any) {
            console.warn("[WebhookTracker] Startup recovery sweep error:", err.message);
            return 0;
        }
    }
}
