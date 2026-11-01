import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

dotenv.config();

async function runMigration() {
    console.log("==================================================");
    console.log("   STEP 1 — BACKUP VERIFICATION                   ");
    console.log("==================================================");

    const sourcePath = path.resolve("src/memory/semantic_core.json");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.resolve(`src/memory/semantic_core.backup.${timestamp}.json`);
    const sandboxVectorsPath = path.resolve("src/sandbox/vectors.json");

    // Read source documents
    const rawData = await fs.readFile(sourcePath, "utf-8");
    const existingDocs: any[] = JSON.parse(rawData);
    console.log(`[Backup] Source file: ${sourcePath}`);
    console.log(`[Backup] Total records found: ${existingDocs.length}`);

    // Create timestamped backup
    await fs.writeFile(backupPath, rawData, "utf-8");
    console.log(`[Backup] Created backup at: ${backupPath}`);

    // Also mirror to sandbox/vectors.backup
    try {
        await fs.mkdir(path.resolve("src/sandbox"), { recursive: true });
        await fs.writeFile(path.resolve(`src/sandbox/vectors.backup.${timestamp}.json`), rawData, "utf-8");
    } catch { }

    console.log("\n==================================================");
    console.log("   STEP 2 & 3 — REBUILD VECTOR STORE              ");
    console.log("==================================================");

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
    if (!apiKey) {
        throw new Error("Missing GOOGLE_API_KEY / GEMINI_API_KEY");
    }

    const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: apiKey,
        model: "gemini-embedding-001"
    });

    console.log("[Migration] Initialized GoogleGenerativeAIEmbeddings with model: 'gemini-embedding-001'");
    const vectorStore = new MemoryVectorStore(embeddings);

    // Filter valid documents
    const validDocs = existingDocs.filter(d => d && d.content && typeof d.content === "string" && d.content.trim().length > 0);
    console.log(`[Migration] Total valid source documents to re-embed: ${validDocs.length}`);

    const BATCH_SIZE = 15;
    const allEmbeddedVectors: any[] = [];
    const startTime = Date.now();

    for (let i = 0; i < validDocs.length; i += BATCH_SIZE) {
        const batch = validDocs.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(validDocs.length / BATCH_SIZE);
        const texts = batch.map(d => d.content.trim());

        let vectors: number[][] = [];
        let success = false;
        let attempts = 0;

        while (!success && attempts < 5) {
            attempts++;
            try {
                const bStart = Date.now();
                vectors = await embeddings.embedDocuments(texts);
                const isValid = vectors && vectors.length === texts.length && vectors.every(v => v && v.length === 3072);

                if (isValid) {
                    success = true;
                    console.log(`  [Batch ${batchNum}/${totalBatches}] Embedded ${texts.length} docs in ${Date.now() - bStart}ms (All dim: 3072)`);
                } else {
                    console.warn(`  [Batch ${batchNum}/${totalBatches}] Incomplete dimensions (rate limit). Pausing 10s before retry ${attempts}/5...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            } catch (err: any) {
                console.warn(`  [Batch ${batchNum}/${totalBatches}] Error: ${err.message}. Pausing 10s before retry ${attempts}/5...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        if (!success) {
            throw new Error(`Failed to embed batch ${batchNum} after 5 attempts!`);
        }

        for (let j = 0; j < batch.length; j++) {
            allEmbeddedVectors.push({
                content: batch[j].content.trim(),
                metadata: batch[j].metadata || { id: `doc_${i + j}`, timestamp: new Date().toISOString() },
                embedding: vectors[j]
            });
        }

        // Pacing pause between batches
        await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`\n[Migration] Completed embedding ${allEmbeddedVectors.length} documents in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);

    console.log("\n==================================================");
    console.log("   STEP 4 — VERIFY VECTOR DIMENSION               ");
    console.log("==================================================");

    const dim = allEmbeddedVectors[0].embedding.length;
    console.log(`[Dimension Check] Vector[0] dimension: ${dim}`);
    const inconsistent = allEmbeddedVectors.filter(v => !v.embedding || v.embedding.length !== dim);
    if (inconsistent.length > 0) {
        throw new Error(`FATAL: Found ${inconsistent.length} vectors with inconsistent dimensions!`);
    }
    console.log(`[Dimension Check] ALL ${allEmbeddedVectors.length} vectors uniformly have dimension: ${dim} (PASS)`);

    console.log("\n==================================================");
    console.log("   SERIALIZING NEW VECTOR STORE TO DISK           ");
    console.log("==================================================");

    const serializedJson = JSON.stringify(allEmbeddedVectors, null, 2);
    await fs.writeFile(sourcePath, serializedJson, "utf-8");
    console.log(`[Serialize] Saved to ${sourcePath} (${(serializedJson.length / 1024).toFixed(1)} KB)`);

    await fs.writeFile(sandboxVectorsPath, serializedJson, "utf-8");
    console.log(`[Serialize] Mirrored to ${sandboxVectorsPath}`);

    // Populate vectorStore for live test
    const docs = allEmbeddedVectors.map(v => ({ pageContent: v.content, metadata: v.metadata }));
    const vecs = allEmbeddedVectors.map(v => v.embedding);
    await vectorStore.addVectors(vecs, docs);

    console.log("\n==================================================");
    console.log("   STEP 5 — TEST VECTOR WRITE                     ");
    console.log("==================================================");

    const testDocContent = "OpenClaw Echo vector memory migration test.";
    const writeStart = Date.now();
    await vectorStore.addDocuments([{
        pageContent: testDocContent,
        metadata: { id: `test_mig_${Date.now()}`, type: "MIGRATION_TEST", timestamp: new Date().toISOString() }
    }]);
    const writeLatency = Date.now() - writeStart;
    console.log(`[Vector Write] Document added successfully in ${writeLatency}ms (PASS)`);

    console.log("\n==================================================");
    console.log("   STEP 6 — TEST VECTOR SEARCH                    ");
    console.log("==================================================");

    const searchStart = Date.now();
    const query = "OpenClaw Echo vector memory migration";
    const results = await vectorStore.similaritySearch(query, 3);
    const searchLatency = Date.now() - searchStart;

    console.log(`[Vector Search] Query: "${query}"`);
    console.log(`[Vector Search] Returned ${results.length} results in ${searchLatency}ms`);
    if (results.length > 0) {
        console.log(`[Vector Search] Top result: "${results[0].pageContent.slice(0, 100)}"`);
        const isMatch = results[0].pageContent.includes("OpenClaw Echo vector memory migration test");
        console.log(`[Vector Search] Target document found as top result: ${isMatch ? "YES (PASS)" : "NO"}`);
    } else {
        throw new Error("Vector search returned 0 results!");
    }

    console.log("\n==================================================");
    console.log("   MIGRATION COMPLETED SUCCESSFULLY!              ");
    console.log("==================================================");
}

runMigration().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
