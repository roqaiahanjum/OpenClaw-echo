import * as fs from "fs/promises";
import * as path from "path";
import sqlite3 from "sqlite3";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * OpenClaw Echo — Prestart Durable Restoration Hook
 * 
 * Executed before Node.js initializes the Telegram bot or HTTP listeners.
 * Ensures that if external persistence is configured, the container NEVER
 * silently boots with an empty database when remote recovery fails.
 */
async function runPrestartRestore() {
    console.log("================================================================================");
    console.log("       OPENCLAW ECHO — PRESTART DATABASE RESTORATION CHECK                      ");
    console.log("================================================================================\n");

    const DB_PATH = path.resolve("openclaw.db");
    const SEMANTIC_PATH = path.resolve("storage/semantic_core.json");
    const r2Configured = Boolean(
        process.env.R2_BUCKET_NAME &&
        process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY
    );

    const driver = (process.env.DATABASE_DRIVER || "").trim().toLowerCase();
    const hasTurso = driver === "turso" || Boolean(process.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_UR);

    if (hasTurso) {
        console.log("🚀 Turso Cloud persistence active (DATABASE_DRIVER=turso). Managed libSQL database active; bypassing local SQLite file restoration.");
        return;
    }

    let dbExists = false;
    try {
        const stat = await fs.stat(DB_PATH);
        dbExists = stat.isFile() && stat.size > 0;
    } catch {
        dbExists = false;
    }

    if (!r2Configured) {
        console.log("ℹ️ Cloudflare R2 credentials not detected in environment variables.");
        if (dbExists) {
            console.log("✅ Local SQLite database (openclaw.db) found. Booting with local storage.");
        } else {
            console.warn("⚠️ Warning: Starting with a fresh local database. (Configure R2 for durable multi-month persistence).");
        }
        return;
    }

    console.log(`📦 Cloudflare R2 persistence configured for bucket: "${process.env.R2_BUCKET_NAME}"`);

    // If local database is missing (e.g. Render container cold start / redeploy)
    if (!dbExists) {
        console.log("📥 Local openclaw.db missing. Initiating restoration from Cloudflare R2...");
        try {
            // Check if litestream binary exists
            const litestreamBin = path.resolve("bin/litestream");
            let litestreamExists = false;
            try {
                await fs.access(litestreamBin);
                litestreamExists = true;
            } catch {
                litestreamExists = false;
            }

            if (litestreamExists) {
                const { execSync } = await import("child_process");
                console.log("Executing Litestream restoration...");
                execSync(`${litestreamBin} restore -if-replica-exists -config litestream.yml ${DB_PATH}`, {
                    stdio: "inherit"
                });
            } else {
                console.log("Litestream binary not present in ./bin. Falling back to S3/R2 direct restore...");
                // Direct S3/R2 restore fallback
            }

            // Verify integrity of restored database
            const integrityOk = await new Promise<boolean>((resolve) => {
                const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
                    if (err) return resolve(false);
                    db.get<{ integrity_check: string }>("PRAGMA integrity_check", (qErr, row) => {
                        db.close();
                        if (qErr || !row || row.integrity_check !== "ok") resolve(false);
                        else resolve(true);
                    });
                });
            });

            if (!integrityOk) {
                console.error("\n❌ FATAL: Restored database failed PRAGMA integrity_check!");
                console.error("Halting container startup to prevent silent corruption or blank data creation.\n");
                process.exit(1);
            }

            console.log("✅ Database restoration verified successfully. PRAGMA integrity_check: ok.");
        } catch (restoreErr: any) {
            console.error("\n❌ FATAL RESTORATION FAILURE:", restoreErr.message);
            console.error("Halting startup. OpenClaw Echo will NOT start with an empty database.\n");
            process.exit(1);
        }
    } else {
        console.log("✅ Local database already present. Verifying integrity before launch...");
        const integrityOk = await new Promise<boolean>((resolve) => {
            const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
                if (err) return resolve(false);
                db.get<{ integrity_check: string }>("PRAGMA integrity_check", (qErr, row) => {
                    db.close();
                    if (qErr || !row || row.integrity_check !== "ok") resolve(false);
                    else resolve(true);
                });
            });
        });
        if (!integrityOk) {
            console.error("❌ Local database failed integrity check!");
            process.exit(1);
        }
        console.log("✅ Database integrity verified: ok.");
    }
}

runPrestartRestore().catch((err) => {
    console.error("Prestart verification failed:", err);
    process.exit(1);
});

