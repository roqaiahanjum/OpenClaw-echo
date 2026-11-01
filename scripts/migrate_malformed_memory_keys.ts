import { DatabaseConnectionFactory } from "../src/memory/dbAdapter";
import { FactExtractionEngine } from "../src/memory/FactExtractionEngine";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * OpenClaw Echo — Safe Legacy Memory Key Migration Utility
 * 
 * Audits existing memory keys in Turso / SQLite and migrates run-on malformed keys
 * (e.g. "sample_project_is_called_auror") to structured canonical keys (e.g. "sample_project_name").
 * 
 * Safety Guarantees:
 * - NEVER deletes any rows or records.
 * - NEVER resets or drops tables.
 * - Defaults to --dry-run preview mode.
 * - Requires explicit --apply flag to commit changes.
 */
async function runMigration() {
    const isApply = process.argv.includes("--apply");

    console.log("================================================================================");
    console.log(`  OPENCLAW ECHO: LEGACY MEMORY KEY MIGRATION UTILITY (${isApply ? "LIVE APPLY" : "DRY-RUN PREVIEW"})`);
    console.log("================================================================================\n");

    const db = DatabaseConnectionFactory.getConnection();
    const engine = FactExtractionEngine.getInstance();

    console.log(`Connected to database driver: "${db.getDriverName()}"`);

    const rows = await db.all<any>(
        `SELECT id, chat_id, category, key, value, timestamp FROM knowledge ORDER BY timestamp ASC`
    );

    console.log(`Total knowledge records scanned: ${rows.length}\n`);

    const candidates: Array<{
        id: string;
        chat_id: string;
        currentCategory: string;
        currentKey: string;
        currentValue: string;
        proposedCategory: string;
        proposedKey: string;
        proposedValue: string;
        reason: string;
    }> = [];

    for (const row of rows) {
        const key = row.key || "";
        const val = row.value || "";

        // Check if key is a malformed run-on phrase
        const isRunOnPhrase = key.includes("_is_") || key.includes("_called_") || key.includes("_named_") || key.length >= 28;
        const isGenericCategory = row.category === "user_memory";

        if (isRunOnPhrase || isGenericCategory) {
            // Attempt extraction from value or combined text
            const textToParse = val.length > 5 ? val : key.replace(/_/g, " ");
            const extracted = engine.extractWithRules(textToParse) || engine.extractWithRules(`remember that ${textToParse}`);

            if (extracted && extracted.key !== key) {
                candidates.push({
                    id: row.id,
                    chat_id: row.chat_id,
                    currentCategory: row.category,
                    currentKey: key,
                    currentValue: val,
                    proposedCategory: extracted.category,
                    proposedKey: extracted.key,
                    proposedValue: extracted.value || val,
                    reason: `Normalized from run-on phrase to canonical key "${extracted.key}" [${extracted.category}]`
                });
            }
        }
    }

    if (candidates.length === 0) {
        console.log("✅ All knowledge memory keys are already clean and canonical. No migration required.");
        return;
    }

    console.log(`Found ${candidates.length} candidate record(s) for key normalization:\n`);

    candidates.forEach((c, idx) => {
        console.log(`${idx + 1}. [Chat: ${c.chat_id}] [ID: ${c.id}]`);
        console.log(`   BEFORE: [${c.currentCategory}] "${c.currentKey}" = "${c.currentValue}"`);
        console.log(`   AFTER:  [${c.proposedCategory}] "${c.proposedKey}" = "${c.proposedValue}"`);
        console.log(`   REASON: ${c.reason}\n`);
    });

    if (!isApply) {
        console.log("--------------------------------------------------------------------------------");
        console.log("ℹ️ DRY-RUN ONLY: No changes were applied to the database.");
        console.log("To apply these changes safely, re-run with: npx ts-node scripts/migrate_malformed_memory_keys.ts --apply");
        console.log("--------------------------------------------------------------------------------");
        return;
    }

    console.log("Applying updates to database...");
    let appliedCount = 0;

    for (const c of candidates) {
        try {
            await db.run(
                `UPDATE knowledge 
                 SET category = ?, key = ?, value = ?, confidence = 1.0, timestamp = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [c.proposedCategory, c.proposedKey, c.proposedValue, c.id]
            );
            appliedCount++;
            console.log(`✅ Updated record ${c.id}: "${c.currentKey}" -> "${c.proposedKey}"`);
        } catch (updateErr: any) {
            console.error(`❌ Error updating record ${c.id}:`, updateErr.message);
        }
    }

    console.log(`\n🎉 Successfully migrated ${appliedCount}/${candidates.length} memory records in ${db.getDriverName()}!`);
}

runMigration().then(() => process.exit(0)).catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});

