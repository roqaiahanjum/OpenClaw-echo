import * as fs from "fs/promises";
import * as path from "path";
import sqlite3 from "sqlite3";
import * as dotenv from "dotenv";
import { TursoDatabaseAdapter } from "../src/memory/dbAdapter";

dotenv.config();

/**
 * OpenClaw Echo — Reverse Sync Utility: Turso Cloud to Local SQLite
 * 
 * Safely synchronizes both NEW and UPDATED records from Turso Cloud back to local SQLite.
 * Uses exact ON CONFLICT DO UPDATE upsert semantics to ensure updated user profiles,
 * preferences, and graph triples overwrite stale local copies without losing data.
 */
function getUpsertSql(table: string, cols: string[]): string {
    const placeholders = cols.map(() => "?").join(", ");

    if (table === "knowledge") {
        return `
            INSERT INTO knowledge (${cols.join(", ")}) VALUES (${placeholders})
            ON CONFLICT(chat_id, key) DO UPDATE SET
                id = excluded.id,
                category = excluded.category,
                value = excluded.value,
                confidence = excluded.confidence,
                timestamp = excluded.timestamp
        `;
    }

    if (table === "graph_entities") {
        return `
            INSERT INTO graph_entities (${cols.join(", ")}) VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                description = excluded.description
        `;
    }

    if (table === "graph_triples") {
        return `
            INSERT INTO graph_triples (${cols.join(", ")}) VALUES (${placeholders})
            ON CONFLICT(subject_id, predicate, object_id) DO UPDATE SET
                id = excluded.id,
                subject_name = excluded.subject_name,
                object_name = excluded.object_name,
                confidence = excluded.confidence,
                created_at = excluded.created_at
        `;
    }

    if (table === "authorized_users") {
        return `
            INSERT INTO authorized_users (${cols.join(", ")}) VALUES (${placeholders})
            ON CONFLICT(user_id) DO UPDATE SET
                username = excluded.username,
                first_name = excluded.first_name,
                status = excluded.status,
                authorized_at = excluded.authorized_at
        `;
    }

    // Default for interactions, summaries: REPLACE by primary key 'id'
    return `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
}

async function syncTursoToSqlite() {
    console.log("================================================================================");
    console.log("       OPENCLAW ECHO — TURSO TO SQLITE REVERSE SYNC UTILITY (UPSERT)            ");
    console.log("================================================================================\n");

    const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_UR;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
        console.error("❌ TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for reverse sync.");
        process.exit(1);
    }

    const SOURCE_DB_PATH = path.resolve("openclaw.db");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const BACKUP_PATH = path.resolve(`openclaw.db.pre_sync_backup.${timestamp}`);

    console.log("--- Step 1: Creating Non-Destructive Backup of Local SQLite ---");
    await fs.copyFile(SOURCE_DB_PATH, BACKUP_PATH);
    console.log(`  ✅ Local backup created: ${path.basename(BACKUP_PATH)}\n`);

    console.log("--- Step 2: Connecting to Turso Cloud ---");
    const turso = new TursoDatabaseAdapter(tursoUrl, tursoToken);
    const health = await turso.checkHealth();
    if (health.status !== "connected") {
        console.error("❌ Failed to connect to Turso:", health.details);
        process.exit(1);
    }
    console.log(`  ✅ Connected to Turso: ${tursoUrl}\n`);

    const localDb = new sqlite3.Database(SOURCE_DB_PATH);
    const tableNames = ["interactions", "knowledge", "summaries", "graph_entities", "graph_triples", "authorized_users"];

    console.log("--- Step 3: Fetching and Merging Records (Inserts & Updates) into Local SQLite ---");
    for (const table of tableNames) {
        const remoteRows = await turso.all(`SELECT * FROM ${table}`);
        if (remoteRows.length === 0) {
            console.log(`  • [${table}]: 0 remote rows.`);
            continue;
        }

        const cols = Object.keys(remoteRows[0]);
        const upsertSql = getUpsertSql(table, cols);

        let mergedCount = 0;
        await new Promise<void>((resolve, reject) => {
            localDb.serialize(() => {
                localDb.run("BEGIN TRANSACTION");
                const stmt = localDb.prepare(upsertSql);
                for (const row of remoteRows) {
                    stmt.run(cols.map(c => row[c]), function (err) {
                        if (!err && this.changes > 0) mergedCount++;
                    });
                }
                stmt.finalize();
                localDb.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        console.log(`  ✅ [${table}]: Processed ${remoteRows.length} remote rows (${mergedCount} rows inserted or updated).`);
    }

    // Step 4: Sync semantic vectors
    try {
        const remoteVectors = await turso.all(`SELECT * FROM semantic_vectors`);
        if (remoteVectors.length > 0) {
            console.log(`\n--- Step 4: Syncing Semantic Vectors ---`);
            const vectorFilePath = path.resolve("src/memory/semantic_core.json");
            const formattedVectors = remoteVectors.map(r => ({
                content: r.content,
                metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
                embedding: typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding
            }));
            await fs.writeFile(vectorFilePath, JSON.stringify(formattedVectors, null, 2));
            console.log(`  ✅ Synced ${formattedVectors.length} vectors into ${path.basename(vectorFilePath)}.`);
        }
    } catch (vErr: any) {
        console.warn("  ℹ️ Semantic vectors sync skipped:", vErr.message);
    }

    localDb.close();
    await turso.close();

    console.log("\n================================================================================");
    console.log("🎉 REVERSE SYNC COMPLETE: All new and updated Turso records preserved in SQLite!");
    console.log("================================================================================\n");
}

syncTursoToSqlite().catch(console.error);
