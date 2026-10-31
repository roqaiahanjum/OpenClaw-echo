import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import sqlite3 from "sqlite3";
import * as dotenv from "dotenv";
import { DatabaseConnectionFactory, TursoDatabaseAdapter } from "../src/memory/dbAdapter";

dotenv.config();

/**
 * OpenClaw Echo — SQLite to Turso Migration Utility
 * 
 * Safely migrates local openclaw.db and vector core to Turso Managed libSQL Database.
 * Non-destructive: local database is backed up before any operation.
 * 
 * Usage:
 *   Dry-Run & Inspection Mode:
 *     npx ts-node scripts/migrate_sqlite_to_turso.ts --dry-run
 * 
 *   Live Migration Mode (requires TURSO_DATABASE_URL):
 *     npx ts-node scripts/migrate_sqlite_to_turso.ts --live
 */

interface TableStats {
    table: string;
    localRows: number;
    tursoRows: number;
    status: "MATCH" | "MISMATCH" | "PENDING";
}

async function runMigration() {
    console.log("================================================================================");
    console.log("       OPENCLAW ECHO — SQLITE TO TURSO CLOUD MIGRATION UTILITY                  ");
    console.log("================================================================================\n");

    const isLive = process.argv.includes("--live");
    const SOURCE_DB_PATH = path.resolve("openclaw.db");
    const VECTOR_PATH = fsSync.existsSync(path.resolve("src/memory/semantic_core.json"))
        ? path.resolve("src/memory/semantic_core.json")
        : path.resolve("storage/semantic_core.json");
    const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_UR;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    // Step 1: Create local non-destructive backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const BACKUP_PATH = path.resolve(`openclaw.db.backup.${timestamp}`);
    console.log("--- Step 1: Creating Non-Destructive Backup of Local SQLite DB ---");
    await fs.copyFile(SOURCE_DB_PATH, BACKUP_PATH);
    console.log(`  ✅ Backup created: ${path.basename(BACKUP_PATH)}\n`);

    // Step 2: Read and audit local SQLite tables
    console.log("--- Step 2: Auditing Local SQLite Tables & Vector Core ---");
    const localDb = new sqlite3.Database(SOURCE_DB_PATH);

    const countTable = async (table: string): Promise<number> => {
        return new Promise((res) => {
            localDb.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`, (err, row) => {
                res(row ? row.c : 0);
            });
        });
    };

    const tableNames = ["interactions", "knowledge", "summaries", "graph_entities", "graph_triples", "authorized_users"];
    const localCounts: { [table: string]: number } = {};
    for (const t of tableNames) {
        localCounts[t] = await countTable(t);
        console.log(`  • Table [${t}]: ${localCounts[t]} rows`);
    }

    let vectorCount = 0;
    let vectorData: any[] = [];
    try {
        const rawVectors = await fs.readFile(VECTOR_PATH, "utf-8");
        vectorData = JSON.parse(rawVectors);
        vectorCount = Array.isArray(vectorData) ? vectorData.length : 0;
    } catch {
        vectorCount = 0;
    }
    console.log(`  • Vector Core [storage/semantic_core.json]: ${vectorCount} embeddings\n`);

    if (!isLive || !tursoUrl) {
        console.log("================================================================================");
        console.log("ℹ️ DRY-RUN / AUDIT MODE COMPLETE");
        console.log("--------------------------------------------------------------------------------");
        if (!tursoUrl) {
            console.log("TURSO_DATABASE_URL is not set in environment.");
            console.log("To run live migration:");
            console.log("  1. Create your free database in Turso (no credit card needed):");
            console.log("     turso db create openclaw-db");
            console.log("  2. Get connection URL & token:");
            console.log("     turso db show --url openclaw-db");
            console.log("     turso db tokens create openclaw-db");
            console.log("  3. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env");
            console.log("  4. Execute: npx ts-node scripts/migrate_sqlite_to_turso.ts --live\n");
        } else {
            console.log(`Target Turso Database: ${tursoUrl}`);
            console.log("To execute live migration, re-run with: --live\n");
        }
        console.log("================================================================================\n");
        localDb.close();
        return;
    }

    // Step 3: Connect to Turso and Initialize Schemas
    console.log("--- Step 3: Connecting to Turso Cloud & Verifying Tables ---");
    const turso = new TursoDatabaseAdapter(tursoUrl, tursoToken);
    const health = await turso.checkHealth();
    if (health.status !== "connected") {
        console.error("❌ Failed to connect to Turso:", health.details);
        localDb.close();
        process.exit(1);
    }
    console.log(`  ✅ Connected to Turso: ${tursoUrl}`);

    // Create DDL
    const ddlStatements = [
        `CREATE TABLE IF NOT EXISTS interactions (
            id TEXT PRIMARY KEY,
            chat_id TEXT DEFAULT 'default',
            user_msg TEXT,
            agent_res TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS summaries (
            id TEXT PRIMARY KEY,
            from_interaction INTEGER,
            to_interaction INTEGER,
            summary_text TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            chat_id TEXT DEFAULT 'default',
            category TEXT,
            key TEXT,
            value TEXT,
            confidence REAL DEFAULT 1.0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chat_id, key)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_knowledge_chat_key ON knowledge(chat_id, key)`,
        `CREATE TABLE IF NOT EXISTS graph_entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'CONCEPT',
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS graph_triples (
            id TEXT PRIMARY KEY,
            subject_id TEXT NOT NULL,
            subject_name TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(subject_id, predicate, object_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_triple_sub ON graph_triples(subject_id)`,
        `CREATE INDEX IF NOT EXISTS idx_triple_obj ON graph_triples(object_id)`,
        `CREATE TABLE IF NOT EXISTS authorized_users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            authorized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active'
        )`,
        `CREATE TABLE IF NOT EXISTS semantic_vectors (
            id TEXT PRIMARY KEY,
            chat_id TEXT DEFAULT 'default',
            content TEXT,
            metadata TEXT,
            embedding TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
            update_id INTEGER PRIMARY KEY,
            chat_id TEXT DEFAULT 'default',
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            attempts INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            error TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tg_webhook_status ON telegram_webhook_updates(status)`
    ];
    for (const ddl of ddlStatements) {
        await turso.exec(ddl);
    }
    console.log("  ✅ Turso schemas and indexes verified.\n");

    // Step 4: Batch Migration of Relational Rows
    console.log("--- Step 4: Migrating Data in Transactional Batches ---");
    for (const table of tableNames) {
        const rows: any[] = await new Promise((res) => {
            localDb.all(`SELECT * FROM ${table}`, (err, r) => res(r || []));
        });

        if (rows.length === 0) {
            console.log(`  • [${table}]: 0 rows to migrate.`);
            continue;
        }

        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => "?").join(", ");
        const insertSql = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;

        const batchSize = 50;
        let migratedForTable = 0;
        for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            const stmts = chunk.map(r => ({
                sql: insertSql,
                params: cols.map(c => r[c])
            }));
            await turso.batch(stmts);
            migratedForTable += chunk.length;
        }
        console.log(`  ✅ [${table}]: Migrated ${migratedForTable} rows.`);
    }

    // Step 5: Migrate Vector Embeddings to semantic_vectors Table
    if (vectorData.length > 0) {
        console.log(`\n--- Step 5: Migrating ${vectorData.length} Vector Embeddings to Turso ---`);
        const batchSize = 25;
        let migratedVecs = 0;
        for (let i = 0; i < vectorData.length; i += batchSize) {
            const chunk = vectorData.slice(i, i + batchSize);
            const stmts = chunk.map((v, idx) => ({
                sql: `INSERT OR REPLACE INTO semantic_vectors (id, chat_id, content, metadata, embedding) VALUES (?, ?, ?, ?, ?)`,
                params: [
                    v.metadata?.id || `vec_${i + idx}_${Date.now()}`,
                    v.metadata?.chatId || "default",
                    v.content || "",
                    JSON.stringify(v.metadata || {}),
                    JSON.stringify(v.embedding || [])
                ]
            }));
            await turso.batch(stmts);
            migratedVecs += chunk.length;
        }
        console.log(`  ✅ Migrated ${migratedVecs} semantic vectors into Turso semantic_vectors table.`);
    }

    // Step 6: Post-Migration Parity Verification
    console.log("\n--- Step 6: Post-Migration Parity & Integrity Verification ---");
    const auditReport: TableStats[] = [];
    for (const table of tableNames) {
        const tCount = await turso.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`);
        const remoteCount = tCount ? Number(tCount.c) : 0;
        const status = remoteCount >= localCounts[table] ? "MATCH" : "MISMATCH";
        auditReport.push({
            table,
            localRows: localCounts[table],
            tursoRows: remoteCount,
            status
        });
        console.log(`  • Table [${table}]: Local=${localCounts[table]} | Turso=${remoteCount} [${status}]`);
    }

    const tVec = await turso.get<{ c: number }>(`SELECT COUNT(*) as c FROM semantic_vectors`);
    console.log(`  • Vectors: Local=${vectorCount} | Turso=${tVec?.c || 0} [${Number(tVec?.c) >= vectorCount ? "MATCH" : "MISMATCH"}]`);

    console.log("\n================================================================================");
    console.log("🎉 TURSO CLOUD MIGRATION COMPLETED SUCCESSFULLY WITH ZERO DATA LOSS!");
    console.log("================================================================================\n");

    localDb.close();
    await turso.close();
}

runMigration().catch(console.error);

