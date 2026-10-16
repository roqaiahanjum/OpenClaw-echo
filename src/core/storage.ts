import * as path from "path";
import * as fs from "fs";

/**
 * Centralized Storage & Persistence Configuration for OpenClaw Echo
 * 
 * Supports Railway Persistent Volume mounting via OPENCLAW_DATA_DIR (e.g. /app/data).
 * Preserves 100% backward compatibility with default local development paths when unset.
 */

// Proposed Railway volume mount path: /app/data
const BASE_DATA_DIR = process.env.OPENCLAW_DATA_DIR
    ? path.resolve(process.env.OPENCLAW_DATA_DIR)
    : process.cwd();

// SQLite Database Path: override via SQLITE_DB_PATH or defaults to <BASE_DATA_DIR>/openclaw.db
export const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH
    ? path.resolve(process.env.SQLITE_DB_PATH)
    : (process.env.OPENCLAW_DATA_DIR
        ? path.join(BASE_DATA_DIR, "openclaw.db")
        : path.resolve(process.cwd(), "openclaw.db"));

// Semantic / Vector Memory JSON Path: override via SEMANTIC_CORE_PATH or defaults to <BASE_DATA_DIR>/semantic_core.json
// If running in local development without OPENCLAW_DATA_DIR, falls back to src/memory/semantic_core.json
export const SEMANTIC_CORE_PATH = process.env.SEMANTIC_CORE_PATH
    ? path.resolve(process.env.SEMANTIC_CORE_PATH)
    : (process.env.OPENCLAW_DATA_DIR
        ? path.join(BASE_DATA_DIR, "semantic_core.json")
        : path.resolve(process.cwd(), "src", "memory", "semantic_core.json"));

// Sandbox Directory Path: override via SANDBOX_DIR or defaults to <BASE_DATA_DIR>/sandbox or src/sandbox
export const SANDBOX_DIR = process.env.SANDBOX_DIR
    ? path.resolve(process.env.SANDBOX_DIR)
    : (process.env.OPENCLAW_DATA_DIR
        ? path.join(BASE_DATA_DIR, "sandbox")
        : path.resolve(process.cwd(), "src", "sandbox"));

// Goals JSON storage path: inside SANDBOX_DIR
export const GOALS_STORAGE_PATH = path.join(SANDBOX_DIR, "goals.json");

// Clockwork schedules JSON storage path: inside SANDBOX_DIR
export const SCHEDULES_STORAGE_PATH = path.join(SANDBOX_DIR, "schedules.json");

/**
 * Ensures all required storage directories exist on disk.
 */
export function ensureStorageDirectories(): void {
    try {
        const dbDir = path.dirname(SQLITE_DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const memDir = path.dirname(SEMANTIC_CORE_PATH);
        if (!fs.existsSync(memDir)) {
            fs.mkdirSync(memDir, { recursive: true });
        }
        if (!fs.existsSync(SANDBOX_DIR)) {
            fs.mkdirSync(SANDBOX_DIR, { recursive: true });
        }
    } catch (err: any) {
        console.warn("[StorageConfig] Warning creating storage directories:", err.message);
    }
}
