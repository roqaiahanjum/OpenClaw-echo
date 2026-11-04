import * as crypto from "crypto";
import sqlite3 from "sqlite3";
import { SQLITE_DB_PATH } from "./storage";
import { DatabaseConnectionFactory, IDatabaseConnection, SqliteDatabaseAdapter } from "../memory/dbAdapter";

/**
 * OpenClaw Echo — Demo Access Code & User Authentication Engine
 *
 * Implements salted PBKDF2 hash verification, constant-time equality check,
 * in-memory rate limiting with lockout against brute-force attacks,
 * and SQLite persistence for authorized Telegram user IDs.
 */

export interface RateLimitStatus {
    locked: boolean;
    remainingSec: number;
    attempts: number;
}

export interface FailedAttemptResult {
    locked: boolean;
    remainingAttempts: number;
    lockoutSec: number;
}

export interface AuthorizedUserRecord {
    user_id: string;
    username?: string;
    first_name?: string;
    authorized_at: string;
    status: string;
}

// ◄── CRYPTOGRAPHIC ACCESS CODE UTILITIES ──►

/**
 * Generates a salted PBKDF2 hash of an access code in format `<salt_hex>:<hash_hex>`.
 * Can be used by administrators to generate the value for DEMO_ACCESS_CODE_HASH.
 */
export function createSaltedHash(code: string, saltBytes: number = 16): string {
    const salt = crypto.randomBytes(saltBytes).toString("hex");
    const hash = crypto.pbkdf2Sync(code.trim(), salt, 100000, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
}

/**
 * Verifies a candidate code against a stored salted hash using constant-time comparison.
 * Never throws; returns false on any format irregularity or mismatch.
 */
export function verifyAccessCode(candidateCode: string, storedHashEnv?: string): boolean {
    if (!candidateCode || typeof candidateCode !== "string") return false;
    const stored = storedHashEnv || process.env.DEMO_ACCESS_CODE_HASH;
    if (!stored || typeof stored !== "string") return false;

    const trimmed = stored.trim();
    const delimiter = trimmed.includes(":") ? ":" : (trimmed.includes("$") ? "$" : null);
    if (!delimiter) return false;

    const parts = trimmed.split(delimiter);
    if (parts.length !== 2) return false;
    const [salt, expectedHash] = parts;
    if (!salt || !expectedHash) return false;

    try {
        const candidateHash = crypto.pbkdf2Sync(candidateCode.trim(), salt, 100000, 64, "sha512").toString("hex");
        const expectedBuf = Buffer.from(expectedHash, "hex");
        const candidateBuf = Buffer.from(candidateHash, "hex");

        if (expectedBuf.length !== candidateBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuf, candidateBuf);
    } catch {
        return false;
    }
}

// ◄── RATE LIMITER (BRUTE FORCE PROTECTION) ──►

export class AuthRateLimiter {
    private maxAttempts: number;
    private lockoutDurationMs: number;
    private attemptsMap: Map<string, { attempts: number; lockedUntil: number; lastAttempt: number }> = new Map();

    constructor(maxAttempts: number = 5, lockoutDurationMs: number = 15 * 60 * 1000) {
        this.maxAttempts = maxAttempts;
        this.lockoutDurationMs = lockoutDurationMs;
    }

    public check(userId: string): RateLimitStatus {
        const record = this.attemptsMap.get(userId);
        if (!record) {
            return { locked: false, remainingSec: 0, attempts: 0 };
        }

        const now = Date.now();
        if (record.lockedUntil > now) {
            return {
                locked: true,
                remainingSec: Math.ceil((record.lockedUntil - now) / 1000),
                attempts: record.attempts
            };
        }

        // Lockout expired; reset if older than lockout window
        if (record.lockedUntil > 0 && record.lockedUntil <= now) {
            this.attemptsMap.delete(userId);
            return { locked: false, remainingSec: 0, attempts: 0 };
        }

        // Inactivity window reset (if last attempt was more than lockoutDuration ago)
        if (now - record.lastAttempt > this.lockoutDurationMs) {
            this.attemptsMap.delete(userId);
            return { locked: false, remainingSec: 0, attempts: 0 };
        }

        return { locked: false, remainingSec: 0, attempts: record.attempts };
    }

    public recordFailure(userId: string): FailedAttemptResult {
        const now = Date.now();
        let record = this.attemptsMap.get(userId);
        if (!record) {
            record = { attempts: 0, lockedUntil: 0, lastAttempt: now };
            this.attemptsMap.set(userId, record);
        }

        record.attempts += 1;
        record.lastAttempt = now;

        if (record.attempts >= this.maxAttempts) {
            record.lockedUntil = now + this.lockoutDurationMs;
            return {
                locked: true,
                remainingAttempts: 0,
                lockoutSec: Math.ceil(this.lockoutDurationMs / 1000)
            };
        }

        return {
            locked: false,
            remainingAttempts: this.maxAttempts - record.attempts,
            lockoutSec: 0
        };
    }

    public reset(userId: string): void {
        this.attemptsMap.delete(userId);
    }

    public clearAll(): void {
        this.attemptsMap.clear();
    }
}

// ◄── AUTHENTICATION MANAGER & SQLITE PERSISTENCE ──►

export class AuthManager {
    private static instance: AuthManager;
    private customDbPath?: string;
    private dbConnection: IDatabaseConnection | null = null;
    private authorizedCache: Set<string> = new Set();
    private rateLimiter: AuthRateLimiter;
    private isInitialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    private constructor(dbPath?: string, rateLimiter?: AuthRateLimiter) {
        if (dbPath && dbPath !== SQLITE_DB_PATH) {
            this.customDbPath = dbPath;
        }
        this.rateLimiter = rateLimiter || new AuthRateLimiter(5, 15 * 60 * 1000);
    }

    private get db(): IDatabaseConnection {
        if (!this.dbConnection) {
            if (this.customDbPath) {
                this.dbConnection = new SqliteDatabaseAdapter(this.customDbPath);
            } else {
                this.dbConnection = DatabaseConnectionFactory.getConnection();
            }
        }
        return this.dbConnection;
    }

    public static getInstance(dbPath?: string, rateLimiter?: AuthRateLimiter): AuthManager {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager(dbPath, rateLimiter);
        }
        return AuthManager.instance;
    }

    /**
     * Resets singleton instance (primarily for automated testing environments).
     */
    public static resetInstance(): void {
        if (AuthManager.instance && AuthManager.instance.dbConnection) {
            try {
                AuthManager.instance.dbConnection.close().catch(() => {});
            } catch (_) {}
        }
        (AuthManager as any).instance = undefined;
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const MAX_INIT_ATTEMPTS = 3;
            let lastError: any = null;

            for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
                try {
                    await this.db.exec(`
                        CREATE TABLE IF NOT EXISTS authorized_users (
                            user_id TEXT PRIMARY KEY,
                            username TEXT,
                            first_name TEXT,
                            authorized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            status TEXT DEFAULT 'active'
                        )
                    `);

                    const rows = await this.db.all<{ user_id: string }>(
                        `SELECT user_id FROM authorized_users WHERE status = 'active'`
                    );
                    if (rows) {
                        rows.forEach(r => this.authorizedCache.add(String(r.user_id)));
                        console.log(`[Auth] Loaded ${this.authorizedCache.size} authorized user(s) into cache.`);
                    }
                    this.isInitialized = true;
                    return;
                } catch (err: any) {
                    lastError = err;
                    console.warn(`[Auth] Database initialization attempt ${attempt}/${MAX_INIT_ATTEMPTS} failed: ${err.message}`);
                    if (attempt < MAX_INIT_ATTEMPTS) {
                        await new Promise(r => setTimeout(r, 400 * attempt));
                    }
                }
            }

            // Reset initPromise so future attempts can retry rather than being stuck on rejected promise
            this.initPromise = null;
            console.error("[Auth] Database initialization failed after retries:", lastError?.message || lastError);
            throw lastError;
        })();

        return this.initPromise;
    }

    public isReady(): boolean {
        return this.isInitialized;
    }

    /**
     * Returns true if demo access code authentication is active on the server.
     */
    public isAuthEnabled(): boolean {
        const hash = process.env.DEMO_ACCESS_CODE_HASH || process.env.DEMO_ACCESS_CODE;
        return !!hash && hash.trim().length > 0;
    }

    /**
     * Checks if the given Telegram user ID is an administrator.
     */
    public isAdmin(userId: string | number | undefined): boolean {
        if (!userId) return false;
        const uid = String(userId).trim();
        const adminEnv = process.env.ADMIN_TELEGRAM_ID || "";
        if (!adminEnv.trim()) return false;

        const adminIds = adminEnv.split(",").map(id => id.trim()).filter(Boolean);
        return adminIds.includes(uid);
    }

    /**
     * Returns true if the user is authorized to interact with the bot.
     * Administrators and already-authenticated users pass immediately.
     * If authentication is not configured in env, access remains open.
     * CRITICAL: If auth is configured but uninitialized, access is strictly rejected (fails closed).
     */
    public isUserAuthorized(userId: string | number | undefined): boolean {
        if (!userId) return false;
        const uid = String(userId).trim();

        // If auth is not configured, permit access (fail-open for standard development)
        if (!this.isAuthEnabled()) {
            return true;
        }

        // FAIL CLOSED: If auth is configured in env but database/cache is not initialized,
        // strictly reject access until persistence is restored.
        if (!this.isInitialized) {
            return false;
        }

        // Administrators bypass access codes
        if (this.isAdmin(uid)) {
            return true;
        }

        return this.authorizedCache.has(uid);
    }

    public getRateLimiter(): AuthRateLimiter {
        return this.rateLimiter;
    }

    /**
     * Validates candidate access code and, if valid, persists user authorization in SQLite.
     */
    public async verifyAndAuthorize(
        userId: string | number,
        candidateCode: string,
        meta?: { username?: string; firstName?: string }
    ): Promise<{ success: boolean; error?: string; remainingAttempts?: number; lockoutSec?: number }> {
        const uid = String(userId).trim();

        // Check rate limiting first
        const rateStatus = this.rateLimiter.check(uid);
        if (rateStatus.locked) {
            return {
                success: false,
                error: "LOCKED_OUT",
                lockoutSec: rateStatus.remainingSec
            };
        }

        // Validate code using constant-time comparison
        const storedHash = process.env.DEMO_ACCESS_CODE_HASH;
        let isValid = false;

        if (storedHash) {
            isValid = verifyAccessCode(candidateCode, storedHash);
        } else if (process.env.DEMO_ACCESS_CODE) {
            // Safe fallback if raw code was passed during local test
            const expected = process.env.DEMO_ACCESS_CODE.trim();
            const cand = candidateCode.trim();
            if (expected.length === cand.length) {
                isValid = crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(expected));
            }
        }

        if (!isValid) {
            const failResult = this.rateLimiter.recordFailure(uid);
            return {
                success: false,
                error: failResult.locked ? "LOCKED_OUT" : "INVALID_CODE",
                remainingAttempts: failResult.remainingAttempts,
                lockoutSec: failResult.lockoutSec
            };
        }

        // Verification successful: reset rate limiter and persist authorization
        this.rateLimiter.reset(uid);
        await this.authorizeUser(uid, meta);

        return { success: true };
    }

    /**
     * Persists an authorized user to SQLite and updates the in-memory cache.
     */
    public async authorizeUser(
        userId: string | number,
        meta?: { username?: string; firstName?: string }
    ): Promise<void> {
        const uid = String(userId).trim();
        this.authorizedCache.add(uid);

        const sql = `
            INSERT OR REPLACE INTO authorized_users (user_id, username, first_name, authorized_at, status)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'active')
        `;
        await this.db.run(sql, [uid, meta?.username || null, meta?.firstName || null]);
    }

    /**
     * Revokes a user's authorization in the database and removes them from the in-memory cache.
     */
    public async revokeUser(userId: string | number): Promise<boolean> {
        const uid = String(userId).trim();
        this.authorizedCache.delete(uid);

        const sql = `UPDATE authorized_users SET status = 'revoked' WHERE user_id = ? AND status = 'active'`;
        const res = await this.db.run(sql, [uid]);
        return (res.changes || 0) > 0;
    }

    /**
     * Returns a list of currently active authorized users.
     */
    public async listAuthorizedUsers(): Promise<AuthorizedUserRecord[]> {
        const sql = `
            SELECT user_id, username, first_name, authorized_at, status 
            FROM authorized_users 
            WHERE status = 'active' 
            ORDER BY authorized_at DESC
        `;
        const rows = await this.db.all<AuthorizedUserRecord>(sql, []);
        return rows || [];
    }

    /**
     * Safely closes the database connection.
     */
    public async close(): Promise<void> {
        if (!this.dbConnection) return;
        try {
            await this.dbConnection.close();
        } catch (err: any) {
            console.warn("[Auth] Warning closing auth database:", err.message);
        }
        this.dbConnection = null;
        this.isInitialized = false;
        this.initPromise = null;
    }
}

