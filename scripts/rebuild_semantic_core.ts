import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

dotenv.config();

async function rebuildSemanticCore() {
    console.log("=== REBUILDING SEMANTIC_CORE.JSON WITH gemini-embedding-2 ===");

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
    if (!apiKey) {
        throw new Error("Missing API key (GEMINI_API_KEY or GOOGLE_API_KEY)");
    }

    const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey,
        model: "gemini-embedding-2"
    });

    const sourcePath = path.resolve("src/memory/semantic_core.json");
    const rawData = await fs.readFile(sourcePath, "utf-8");
    const records: any[] = JSON.parse(rawData);

    console.log(`[Rebuild] Total records in semantic_core.json: ${records.length}`);

    // Unique non-empty content strings
    const uniqueTexts = Array.from(new Set(records.map(r => (r.content || "").trim()).filter(Boolean)));
    console.log(`[Rebuild] Unique content texts to embed: ${uniqueTexts.length}`);

    // Load partial cache if present
    const cacheFile = path.resolve("scratch/embedding_cache.json");
    let cache: Record<string, number[]> = {};
    try {
        const cacheData = await fs.readFile(cacheFile, "utf-8");
        cache = JSON.parse(cacheData);
        console.log(`[Cache] Loaded ${Object.keys(cache).length} already-embedded texts from cache.`);
    } catch {}

    const textsToFetch = uniqueTexts.filter(t => !cache[t] || cache[t].length !== 3072);
    console.log(`[Rebuild] Remaining texts to embed via API: ${textsToFetch.length}`);

    const BATCH_SIZE = 20;
    const totalBatches = Math.ceil(textsToFetch.length / BATCH_SIZE);
    const t0 = Date.now();

    for (let i = 0; i < textsToFetch.length; i += BATCH_SIZE) {
        const batch = textsToFetch.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        let success = false;
        let attempts = 0;

        while (!success && attempts < 8) {
            attempts++;
            try {
                const bStart = Date.now();
                const vectors = await embeddings.embedDocuments(batch);
                if (vectors && vectors.length === batch.length && vectors.every(v => Array.isArray(v) && v.length === 3072)) {
                    for (let j = 0; j < batch.length; j++) {
                        cache[batch[j]] = vectors[j];
                    }
                    success = true;
                    console.log(`  [Batch ${batchNum}/${totalBatches}] Embedded ${batch.length} docs in ${Date.now() - bStart}ms (dim: 3072, Total cached: ${Object.keys(cache).length})`);
                    // Save incremental cache
                    await fs.writeFile(cacheFile, JSON.stringify(cache), "utf-8");
                } else {
                    console.warn(`  [Batch ${batchNum}/${totalBatches}] Incomplete response (len: ${vectors?.length}), retry ${attempts}/8 in 10s...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            } catch (err: any) {
                console.warn(`  [Batch ${batchNum}/${totalBatches}] Error: ${err.message}. Waiting 15s before retry ${attempts}/8...`);
                await new Promise(r => setTimeout(r, 15000));
            }
        }

        if (!success) {
            throw new Error(`Failed to embed batch ${batchNum} after 8 attempts!`);
        }

        // 3.5-second pacing delay to stay safely under 15 RPM
        await new Promise(r => setTimeout(r, 3500));
    }

    console.log(`[Rebuild] All ${uniqueTexts.length} unique texts cached in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

    // Assign embeddings to all records
    let populatedCount = 0;
    for (const record of records) {
        const content = (record.content || "").trim();
        const emb = cache[content];
        if (emb && emb.length === 3072) {
            record.embedding = emb;
            populatedCount++;
        } else {
            record.embedding = [];
        }
    }

    console.log(`[Rebuild] Successfully populated embeddings for ${populatedCount}/${records.length} records.`);

    // Write back to semantic_core.json
    const updatedJson = JSON.stringify(records, null, 2);
    await fs.writeFile(sourcePath, updatedJson, "utf-8");
    console.log(`[Rebuild] Saved updated semantic_core.json to ${sourcePath}`);

    const altPath = path.resolve("src/src/memory/semantic_core.json");
    try {
        await fs.writeFile(altPath, updatedJson, "utf-8");
        console.log(`[Rebuild] Mirrored to ${altPath}`);
    } catch {}

    const sandboxPath = path.resolve("src/sandbox/vectors.json");
    try {
        await fs.writeFile(sandboxPath, updatedJson, "utf-8");
        console.log(`[Rebuild] Mirrored to ${sandboxPath}`);
    } catch {}

    console.log("=== SEMANTIC CORE REBUILD COMPLETED SUCCESSFULLY ===");
}

rebuildSemanticCore().then(() => setTimeout(() => process.exit(0), 100)).catch(e => {
    console.error("Rebuild failed:", e);
    process.exit(1);
});
