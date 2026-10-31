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

    private async executeHttpPipeline(requests: any[]): Promise<any> {
        // Convert libsql:// to https://
        let httpEndpoint = this.url.replace(/^libsql:\/\//, "https://");
        if (!httpEndpoint.startsWith("http://") && !httpEndpoint.startsWith("https://")) {
            httpEndpoint = `https://${httpEndpoint}`;
        }
        const pipelineUrl = `${httpEndpoint.replace(/\/+$/, "")}/v2/pipeline`;

        const res = await fetch(pipelineUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})
            },
            body: JSON.stringify({ requests })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Turso HTTP Pipeline error (${res.status}): ${errBody}`);
        }

        const data: any = await res.json();
        return data;
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
            p.then(r => actualCb!(null, r), e => actualCb!(e, null));
            return p;
        }
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
            executePromise.then(r => actualCb!(null, r), e => actualCb!(e, [])).catch(() => {});
            return executePromise;
        }
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
            executePromise.then(
                res => actualCb!.call(res, null, res),
                err => actualCb!(err)
            ).catch(() => {});
            return executePromise;
        }
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
            return { status: "connected", details: `Turso Cloud connected (${this.url})`, driver: "turso" };
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
            } else if (!driver && tursoUrl) {
                console.log("[DatabaseFactory] Initializing Turso Cloud Database Adapter (inferred from TURSO_DATABASE_URL)...");
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

