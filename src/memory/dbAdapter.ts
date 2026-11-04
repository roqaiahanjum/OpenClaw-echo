import sqlite3 from "sqlite3";
import * as dotenv from "dotenv";
import { SQLITE_DB_PATH } from "../core/storage";

dotenv.config();

export interface QueryResult<T = any> {
    rows: T[];
    rowsAffected: number;
    lastInsertRowid?: number | bigint;
}

export interface IDatabaseConnection {
    get<T = any>(sql: string, params?: any, callback?: (err: Error | null, row: T | null) => void): Promise<T | null>;
    all<T = any>(sql: string, params?: any, callback?: (err: Error | null, rows: T[]) => void): Promise<T[]>;
    run(sql: string, params?: any, callback?: (this: any, err: Error | null, result?: any) => void): Promise<{ changes: number; lastID?: number | bigint }>;
    exec(sql: string, callback?: (err: Error | null) => void): Promise<void>;
    batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void>;
    serialize(fn: () => void): void;
    close(callback?: (err: Error | null) => void): Promise<void>;
    getDriverName(): "sqlite" | "turso";
    checkHealth(): Promise<{ status: "connected" | "error"; details: string; driver: string }>;
}

/**
 * Local SQLite Adapter (Default Rollback Driver)
 * Wraps local sqlite3.Database in Promise-based methods.
 */
export class SqliteDatabaseAdapter implements IDatabaseConnection {
    private db: sqlite3.Database;
    private isClosed: boolean = false;

    constructor(dbPath: string = SQLITE_DB_PATH) {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error(`[SqliteAdapter] Connection error to ${dbPath}:`, err.message);
            }
        });
    }

    public getDriverName(): "sqlite" | "turso" {
        return "sqlite";
    }

    public get<T = any>(sql: string, params?: any, callback?: (err: Error | null, row: T | null) => void): Promise<T | null> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const p = new Promise<T | null>((resolve, reject) => {
            this.db.get<T>(sql, actualParams, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (actualCb) {
            p.then(r => actualCb!(null, r), e => actualCb!(e, null)).catch(() => {});
            return p;
        }
        return p;
    }

    public all<T = any>(sql: string, params?: any, callback?: (err: Error | null, rows: T[]) => void): Promise<T[]> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const p = new Promise<T[]>((resolve, reject) => {
            this.db.all<T>(sql, actualParams, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (actualCb) {
            p.then(r => actualCb!(null, r), e => actualCb!(e, [])).catch(() => {});
            return p;
        }
        return p;
    }

    public run(sql: string, params?: any, callback?: (this: any, err: Error | null, result?: any) => void): Promise<{ changes: number; lastID?: number | bigint }> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const p = new Promise<{ changes: number; lastID?: number | bigint }>((resolve, reject) => {
            this.db.run(sql, actualParams, function (err) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
            });
        });

        if (actualCb) {
            p.then(
                res => actualCb!.call(res, null, res),
                err => actualCb!(err)
            ).catch(() => {});
            return p;
        }
        return p;
    }

    public exec(sql: string, callback?: (err: Error | null) => void): Promise<void> {
        const p = new Promise<void>((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        if (callback) {
            p.then(() => callback(null), e => callback(e)).catch(() => {});
            return p;
        }
        return p;
    }

    public serialize(fn: () => void): void {
        this.db.serialize(fn);
    }

    public batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN TRANSACTION");
                for (const stmt of statements) {
                    this.db.run(stmt.sql, stmt.params || []);
                }
                this.db.run("COMMIT", (err) => {
                    if (err) {
                        this.db.run("ROLLBACK", () => reject(err));
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    public close(callback?: (err: Error | null) => void): Promise<void> {
        const p = new Promise<void>((resolve, reject) => {
            if (this.isClosed) return resolve();
            this.db.close((err) => {
                if (err) reject(err);
                else {
                    this.isClosed = true;
                    resolve();
                }
            });
        });
        if (callback) {
            p.then(() => callback(null), e => callback(e));
            return p;
        }
        return p;
    }

    public async checkHealth(): Promise<{ status: "connected" | "error"; details: string; driver: string }> {
        try {
            await this.get("SELECT 1 as alive");
            return { status: "connected", details: `SQLite connected (${SQLITE_DB_PATH})`, driver: "sqlite" };
        } catch (err: any) {
            return { status: "error", details: `SQLite error: ${err.message}`, driver: "sqlite" };
        }
    }
}

/**
 * Turso Database Adapter (libSQL Managed Cloud)
 * Supports both @libsql/client (when installed) and native HTTPS pipeline REST API.
 */
export class TursoDatabaseAdapter implements IDatabaseConnection {
    private url: string;
    private authToken?: string;
    private client: any = null;

    constructor(url: string, authToken?: string) {
        this.url = url;
        this.authToken = authToken;
        this.initClient();
    }

    private initClient(): void {
        try {
            // Attempt to dynamically load @libsql/client if installed
            const libsql = require("@libsql/client");
            this.client = libsql.createClient({
                url: this.url,
                authToken: this.authToken
            });
            console.log(`[TursoAdapter] Connected via @libsql/client SDK to ${this.url}`);
        } catch {
            console.log(`[TursoAdapter] @libsql/client not present; using native HTTPS Pipeline REST protocol.`);
            this.client = null;
        }
    }

    public getDriverName(): "sqlite" | "turso" {
        return "turso";
    }

    private isRetryableTransportError(err: any): boolean {
        if (!err) return false;
        const msg = (err.message || "").toLowerCase();
        const code = err.code || err.cause?.code || "";
        const causeMsg = (err.cause?.message || "").toLowerCase();

        // Socket closed by other side (UND_ERR_SOCKET, SocketError)
        if (code === "UND_ERR_SOCKET" || msg.includes("other side closed") || causeMsg.includes("other side closed") || msg.includes("socket closed")) {
            return true;
        }

        // Connect timeout / network timeout / aborted timeout
        if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" || err.name === "AbortError" || msg.includes("timeout") || causeMsg.includes("timeout")) {
            return true;
        }

        // Network connection reset or abort
        if (code === "ECONNRESET" || code === "EPIPE" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
            return true;
        }

        // Generic fetch failed wrapper with underlying transport cause
        if (msg.includes("fetch failed") && (code === "UND_ERR_SOCKET" || causeMsg.includes("socket") || causeMsg.includes("closed") || causeMsg.includes("timeout") || causeMsg.includes("connect"))) {
            return true;
        }

        // 502/503/504 gateway errors
        if (msg.includes("turso gateway error") || msg.includes("502") || msg.includes("503") || msg.includes("504")) {
            return true;
        }

        return false;
    }

    private isSafeToReplay(requests: any[]): boolean {
        if (!Array.isArray(requests) || requests.length === 0) return false;

        for (const req of requests) {
            const rawSql = (req?.stmt?.sql || "").trim();
            if (!rawSql) return false;
            // Normalize whitespace and uppercase for keyword inspection
            const sql = rawSql.replace(/\s+/g, " ").toUpperCase();

            // 1. Read-only queries are always safe to replay
            if (sql.startsWith("SELECT") || sql.startsWith("PRAGMA") || sql.startsWith("EXPLAIN")) {
                continue;
            }

            // 2. Safe idempotent DDL
            if (
                sql.startsWith("CREATE TABLE IF NOT EXISTS") ||
                sql.startsWith("CREATE INDEX IF NOT EXISTS") ||
                sql.startsWith("DROP TABLE IF EXISTS") ||
                sql.startsWith("DROP INDEX IF EXISTS")
            ) {
                continue;
            }

            // 3. Safe idempotent writes with conflict-ignore or conflict-replace
            if (sql.startsWith("INSERT OR IGNORE") || sql.startsWith("INSERT OR REPLACE")) {
                continue;
            }

            // Any standard INSERT, UPDATE, DELETE, or arbitrary non-idempotent DDL is NOT safe to replay
            return false;
        }

        return true;
    }

    private async executeHttpPipeline(requests: any[]): Promise<any> {
        // Convert libsql:// to https://
        let httpEndpoint = this.url.replace(/^libsql:\/\//, "https://");
        if (!httpEndpoint.startsWith("http://") && !httpEndpoint.startsWith("https://")) {
            httpEndpoint = `https://${httpEndpoint}`;
        }
        const pipelineUrl = `${httpEndpoint.replace(/\/+$/, "")}/v2/pipeline`;

        const isReplayable = this.isSafeToReplay(requests);
        const MAX_RETRIES = isReplayable ? 3 : 1;
        let lastError: any = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            try {
                const res = await fetch(pipelineUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Connection": "keep-alive",
                        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})
                    },
                    body: JSON.stringify({ requests }),
                    signal: controller.signal
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    // 401/403 are terminal auth errors; do not retry
                    if (res.status === 401 || res.status === 403) {
                        throw new Error(`Turso Authentication Error (${res.status}): Invalid or unauthorized TURSO_AUTH_TOKEN. Non-retryable.`);
                    }
                    // 400 is terminal syntax error; do not retry
                    if (res.status === 400) {
                        throw new Error(`Turso SQL/Validation Error (${res.status}): ${errBody.slice(0, 250)}`);
                    }
                    // 502/503/504 are retryable gateway errors
                    if (res.status === 502 || res.status === 503 || res.status === 504) {
                        throw new Error(`Turso Gateway Error (${res.status}): ${errBody.slice(0, 250)}`);
                    }
                    throw new Error(`Turso HTTP Pipeline error (${res.status}): ${errBody.slice(0, 250)}`);
                }

                const data: any = await res.json();
                return data;
            } catch (err: any) {
                lastError = err;

                // Terminal auth or bad request errors must NOT be retried
                const errMsg = err?.message || String(err);
                if (errMsg.includes("Turso Authentication Error") || errMsg.includes("Turso SQL/Validation Error")) {
                    throw err;
                }

                // If non-idempotent write encountered a transport failure, NEVER replay (avoid duplicate side effects)
                if (!isReplayable) {
                    throw new Error(`Turso Ambiguous Transport Failure: Non-idempotent write encountered transport error (${err.message || err}). Automatic replay prohibited to prevent duplicate writes.`);
                }

                // Check for retryable socket/transport errors on safe replayable queries
                const isRetryable = this.isRetryableTransportError(err);
                if (isRetryable && attempt < MAX_RETRIES) {
                    const backoffMs = Math.min(2500, (300 * Math.pow(2, attempt - 1))) + Math.floor(Math.random() * 200);
                    console.warn(`[TursoAdapter] Transient socket/transport error on attempt ${attempt}/${MAX_RETRIES}: ${err.message || err}. Retrying on fresh connection in ${backoffMs}ms...`);
                    await new Promise(r => setTimeout(r, backoffMs));
                    continue;
                }

                if (!isRetryable) {
                    throw err;
                }
            } finally {
                // Guarantee timeout cleanup in all execution paths
                clearTimeout(timeoutId);
            }
        }

        throw new Error(`Turso HTTP Pipeline failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || lastError}`);
    }

    public serialize(fn: () => void): void {
        fn();
    }

    public async get<T = any>(sql: string, params?: any, callback?: (err: Error | null, row: T | null) => void): Promise<T | null> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const p = this.all<T>(sql, actualParams).then(rows => rows.length > 0 ? rows[0] : null);
        if (actualCb) {
            p.then(r => actualCb!(null, r)).catch(e => actualCb!(e, null));
            return p.catch(() => null);
        }
        p.catch(() => {});
        return p;
    }

    private formatArg(p: any): any {
        if (p === null || p === undefined) return { type: "null" };
        if (typeof p === "number") {
            if (Number.isInteger(p)) {
                return { type: "integer", value: String(p) };
            }
            return { type: "float", value: p };
        }
        if (typeof p === "boolean") return { type: "integer", value: p ? "1" : "0" };
        return { type: "text", value: String(p) };
    }

    public async all<T = any>(sql: string, params?: any, callback?: (err: Error | null, rows: T[]) => void): Promise<T[]> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const executePromise = (async () => {
            if (this.client) {
                const res = await this.client.execute({ sql, args: actualParams });
                return (res.rows || []) as T[];
            }

            // Native HTTP pipeline fallback
            const formattedArgs = actualParams.map((p: any) => this.formatArg(p));

            const pipelineRes = await this.executeHttpPipeline([
                { type: "execute", stmt: { sql, args: formattedArgs } }
            ]);

            const firstResult = pipelineRes?.results?.[0];
            if (firstResult?.type === "error" || firstResult?.error) {
                const errMsg = firstResult.error?.message || "Turso query execution error";
                throw new Error(errMsg);
            }

            const execResult = firstResult?.response?.result;
            if (!execResult) return [];

            const cols = (execResult.cols || []).map((c: any) => c.name);
            const rows = (execResult.rows || []).map((row: any[]) => {
                const obj: any = {};
                row.forEach((cell: any, idx: number) => {
                    const colName = cols[idx] || `col_${idx}`;
                    obj[colName] = cell?.value !== undefined ? (cell.type === "integer" ? Number(cell.value) : cell.value) : cell;
                });
                return obj as T;
            });

            return rows;
        })();

        if (actualCb) {
            executePromise
                .then(r => actualCb!(null, r))
                .catch(e => actualCb!(e, []));
            return executePromise.catch(() => [] as T[]);
        }
        executePromise.catch(() => {});
        return executePromise;
    }

    public async run(sql: string, params?: any, callback?: (this: any, err: Error | null, result?: any) => void): Promise<{ changes: number; lastID?: number | bigint }> {
        let actualParams = params;
        let actualCb = callback;
        if (typeof params === "function") {
            actualCb = params;
            actualParams = [];
        }
        actualParams = actualParams || [];

        const executePromise = (async () => {
            if (this.client) {
                const res = await this.client.execute({ sql, args: actualParams });
                return { changes: res.rowsAffected || 0, lastID: res.lastInsertRowid };
            }

            const formattedArgs = actualParams.map((p: any) => this.formatArg(p));

            const pipelineRes = await this.executeHttpPipeline([
                { type: "execute", stmt: { sql, args: formattedArgs } }
            ]);

            const firstResult = pipelineRes?.results?.[0];
            if (firstResult?.type === "error" || firstResult?.error) {
                const errMsg = firstResult.error?.message || "Turso query execution error";
                throw new Error(errMsg);
            }

            const execResult = firstResult?.response?.result;
            return {
                changes: execResult?.affected_row_count || 0,
                lastID: execResult?.last_insert_rowid
            };
        })();

        if (actualCb) {
            executePromise
                .then(res => actualCb!.call(res, null, res))
                .catch(err => actualCb!(err));
            return executePromise.catch(() => ({ changes: 0 }));
        }
        executePromise.catch(() => {});
        return executePromise;
    }

    public async exec(sql: string, callback?: (err: Error | null) => void): Promise<void> {
        const executePromise = (async () => {
            if (this.client) {
                await this.client.execute(sql);
                return;
            }
            const pipelineRes = await this.executeHttpPipeline([
                { type: "execute", stmt: { sql } }
            ]);
            const firstResult = pipelineRes?.results?.[0];
            if (firstResult?.type === "error" || firstResult?.error) {
                const errMsg = firstResult.error?.message || "Turso query execution error";
                throw new Error(errMsg);
            }
        })();

        if (callback) {
            executePromise.then(() => callback(null), e => callback(e)).catch(() => {});
            return executePromise;
        }
        return executePromise;
    }

    public async batch(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
        if (this.client) {
            await this.client.batch(statements.map(s => ({ sql: s.sql, args: s.params || [] })));
            return;
        }

        const requests = statements.map(s => {
            const formattedArgs = (s.params || []).map(p => this.formatArg(p));
            return { type: "execute", stmt: { sql: s.sql, args: formattedArgs } };
        });

        const pipelineRes = await this.executeHttpPipeline(requests);
        for (const res of (pipelineRes?.results || [])) {
            if (res.type === "error" || res.error) {
                throw new Error(res.error?.message || "Turso batch execution error");
            }
        }
    }

    public async close(): Promise<void> {
        if (this.client && typeof this.client.close === "function") {
            await this.client.close();
        }
    }

    public async checkHealth(): Promise<{ status: "connected" | "error"; details: string; driver: string }> {
        try {
            await this.get("SELECT 1 as alive");
            const safeUrl = this.url.split("?")[0].replace(/\/\/.*@/, "//***@");
            return { status: "connected", details: `Turso Cloud connected (${safeUrl})`, driver: "turso" };
        } catch (err: any) {
            return { status: "error", details: `Turso Cloud error: ${err.message}`, driver: "turso" };
        }
    }
}

/**
 * Database Connection Factory
 * Provides unified access with automatic failover / rollback capability.
 */
export class DatabaseConnectionFactory {
    private static instance: IDatabaseConnection | null = null;

    public static getConnection(): IDatabaseConnection {
        if (!DatabaseConnectionFactory.instance) {
            const driver = (process.env.DATABASE_DRIVER || "").toLowerCase();
            const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_UR;
            const tursoToken = process.env.TURSO_AUTH_TOKEN;

            if (driver === "turso") {
                if (!tursoUrl) {
                    throw new Error("[DatabaseFactory] FATAL: DATABASE_DRIVER is set to 'turso', but TURSO_DATABASE_URL is missing. Startup aborted to prevent silent fallback to local SQLite.");
                }
                console.log("[DatabaseFactory] Initializing Turso Cloud Database Adapter...");
                DatabaseConnectionFactory.instance = new TursoDatabaseAdapter(tursoUrl, tursoToken);
            } else if (!driver && tursoUrl && process.env.NODE_ENV === "production") {
                console.log("[DatabaseFactory] Initializing Turso Cloud Database Adapter (inferred from TURSO_DATABASE_URL in production)...");
                DatabaseConnectionFactory.instance = new TursoDatabaseAdapter(tursoUrl, tursoToken);
            } else {
                console.log("[DatabaseFactory] Initializing Local SQLite Adapter (Default)...");
                DatabaseConnectionFactory.instance = new SqliteDatabaseAdapter();
            }
        }
        return DatabaseConnectionFactory.instance;
    }

    public static resetInstance(): void {
        if (DatabaseConnectionFactory.instance) {
            DatabaseConnectionFactory.instance.close().catch(() => {});
            DatabaseConnectionFactory.instance = null;
        }
    }
}

