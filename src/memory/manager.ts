// @ts-nocheck
import sqlite3 from "sqlite3";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { ModelRouter } from "../core/router";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { KnowledgeGraphManager } from "./KnowledgeGraphManager";
import { extractAndStoreTriples } from "./graphExtractor";
import { DashboardLogger } from "../core/logger";
import { SQLITE_DB_PATH, SEMANTIC_CORE_PATH, ensureStorageDirectories } from "../core/storage";
import { DatabaseConnectionFactory, IDatabaseConnection } from "./dbAdapter";
import { FactExtractionEngine, ExtractedFact } from "./FactExtractionEngine";

// Load .env with absolute path — works from any working directory
dotenv.config({ 
  path: path.resolve(__dirname, '../../.env')
});

// Fallback: also try current directory
if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}


interface SerializedVector {
    content: string;
    metadata: any;
    embedding: number[];
}

export interface KnowledgeFact {
    id: string;
    chat_id?: string;
    category: string;
    key: string;
    value: string;
    confidence: number;
    timestamp: string;
}

export type MemoryType = "USER_FACT" | "CONVERSATION" | "KNOWLEDGE" | "SUMMARY";

export class MemoryManager {
    private static instance: MemoryManager;
    private vectorStore: MemoryVectorStore | null = null;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private storagePath: string = SEMANTIC_CORE_PATH;
    private isInitialized: boolean = false;
    private embeddingCache = new Map<string, number[]>();

    private customDb?: IDatabaseConnection;

    private get db(): IDatabaseConnection {
        return this.customDb || DatabaseConnectionFactory.getConnection();
    }

    private constructor(customDb?: IDatabaseConnection) {
        if (customDb) {
            this.customDb = customDb;
        }
        const apiKey = 
            process.env.GOOGLE_API_KEY || 
            process.env.GEMINI_API_KEY || 
            process.env.GEMINI_KEY;

        this.embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: apiKey!,
            model: 'gemini-embedding-001',
        });
    }

    public static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
    }

    public static resetInstance(): void {
        MemoryManager.instance = undefined as any;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        await this.initializeTables();
        await this.initVectorStore();
        this.isInitialized = true;
    }

    private async initializeTables(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS interactions (
                        id TEXT PRIMARY KEY,
                        chat_id TEXT DEFAULT 'default',
                        user_msg TEXT,
                        agent_res TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => { if (err) reject(err); });

                this.db.all(`PRAGMA table_info(interactions)`, (err, rows: any[]) => {
                    const hasChatId = (rows || []).some((r: any) => r.name === 'chat_id');
                    if (!hasChatId) {
                        this.db.run(`ALTER TABLE interactions ADD COLUMN chat_id TEXT DEFAULT 'default'`, () => { });
                    }
                });

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS summaries (
                        id TEXT PRIMARY KEY,
                        from_interaction INTEGER,
                        to_interaction INTEGER,
                        summary_text TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => { if (err) reject(err); });

                // Ensure knowledge table supports per-user isolation with composite uniqueness on (chat_id, key)
                this.db.all(`SELECT sql FROM sqlite_master WHERE type='table' AND name='knowledge'`, (err, rows: any[]) => {
                    if (err) return reject(err);
                    if (!rows || rows.length === 0) {
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS knowledge (
                                id TEXT PRIMARY KEY,
                                chat_id TEXT DEFAULT 'default',
                                category TEXT,
                                key TEXT,
                                value TEXT,
                                confidence REAL DEFAULT 1.0,
                                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                                UNIQUE(chat_id, key)
                            )
                        `, (createErr) => {
                            if (createErr) reject(createErr);
                            else {
                                this.db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_chat_key ON knowledge(chat_id, key)`, () => resolve());
                            }
                        });
                    } else {
                        const createSql = rows[0]?.sql || "";
                        if (createSql.includes("key TEXT UNIQUE") || !createSql.includes("chat_id")) {
                            console.log("[Memory] Migrating legacy knowledge table to support multi-user isolation...");
                            this.db.serialize(() => {
                                this.db.run(`
                                    CREATE TABLE IF NOT EXISTS knowledge_v2 (
                                       id TEXT PRIMARY KEY,
                                       chat_id TEXT DEFAULT 'default',
                                       category TEXT,
                                       key TEXT,
                                       value TEXT,
                                       confidence REAL DEFAULT 1.0,
                                       timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                                       UNIQUE(chat_id, key)
                                    )
                                `);
                                this.db.run(`
                                    INSERT OR IGNORE INTO knowledge_v2 (id, chat_id, category, key, value, confidence, timestamp)
                                    SELECT id, 'default', category, key, value, confidence, timestamp FROM knowledge
                                `);
                                this.db.run(`DROP TABLE knowledge`);
                                this.db.run(`ALTER TABLE knowledge_v2 RENAME TO knowledge`);
                                this.db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_chat_key ON knowledge(chat_id, key)`, (idxErr) => {
                                    if (idxErr) console.warn("[Memory] Index creation warning:", idxErr.message);
                                    resolve();
                                });
                            });
                        } else {
                            this.db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_chat_key ON knowledge(chat_id, key)`, () => resolve());
                        }
                    }
                });
            });
        });
    }

    private async initVectorStore(): Promise<void> {
        try {
            this.vectorStore = new MemoryVectorStore(this.embeddings);

            let serialized: SerializedVector[] = [];

            // If Turso is the active database, attempt loading cloud semantic_vectors first
            if (this.db && this.db.getDriverName() === "turso") {
                try {
                    const rows = await this.db.all<any>(`SELECT id, chat_id, content, metadata, embedding FROM semantic_vectors`);
                    if (rows && rows.length > 0) {
                        console.log(`[Memory] Loading ${rows.length} semantic vectors from Turso cloud...`);
                        serialized = rows.map(r => ({
                            content: r.content,
                            metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata || {}),
                            embedding: typeof r.embedding === "string" ? JSON.parse(r.embedding) : (r.embedding || [])
                        }));
                    }
                } catch (e: any) {
                    console.warn("[Memory] Could not load vectors from Turso cloud table:", e.message);
                }
            }

            // Fallback to local disk file if Turso table was empty or driver is SQLite
            if (serialized.length === 0) {
                try {
                    const data = await fs.readFile(this.storagePath, "utf-8");
                    const fileVectors = JSON.parse(data);
                    if (fileVectors && Array.isArray(fileVectors)) {
                        console.log(`[Memory] Loading ${fileVectors.length} semantic vectors from disk...`);
                        serialized = fileVectors;
                    }
                } catch (e) {
                    console.log("[Memory] No existing semantic core found on disk. Starting fresh.");
                }
            }

            if (serialized && Array.isArray(serialized) && serialized.length > 0) {
                const validItems = serialized.filter(item => Array.isArray(item.embedding) && item.embedding.length === 3072);
                if (validItems.length > 0) {
                    const vectors = validItems.map(item => item.embedding);
                    const docs = validItems.map(item => ({
                        pageContent: item.content,
                        metadata: item.metadata
                    }));
                    await this.vectorStore.addVectors(vectors, docs);
                    console.log(`[Memory] Loaded ${validItems.length} verified 3072-dim vectors into memory.`);
                }
            }
            console.log("[Memory] 4-Layer Vector Store initialized.");
        } catch (error: any) {
            console.log('[Memory] Vector search unavailable — using SQLite only.');
            this.vectorStore = null;
        }
    }

    // --- FACT MANAGEMENT (STRUCTURED EXTRACTION, DEDUPLICATION & CONFLICT RESOLUTION) ---

    public async saveStructuredFact(
        fact: ExtractedFact,
        chatId: string = "default"
    ): Promise<{ success: boolean; action: "created" | "updated" | "deduplicated"; key: string; value: string; category: string }> {
        await this.initialize().catch(() => { });
        const nowIso = new Date().toISOString();

        // 1. Search for existing fact by canonical key or any known legacy aliases
        const candidates = Array.from(new Set([fact.key, ...(fact.aliases || [])]));
        const placeholders = candidates.map(() => "?").join(", ");

        let existing: KnowledgeFact | null = null;
        try {
            existing = await new Promise<KnowledgeFact | null>((resolve) => {
                const sql = chatId === "default"
                    ? `SELECT * FROM knowledge WHERE chat_id = 'default' AND key IN (${placeholders}) LIMIT 1`
                    : `SELECT * FROM knowledge WHERE (chat_id = ? OR (chat_id = 'default' AND ? = 'default')) AND key IN (${placeholders}) LIMIT 1`;
                const params = chatId === "default" ? candidates : [chatId, chatId, ...candidates];
                this.db.get<KnowledgeFact>(sql, params, (err, row) => resolve(row || null));
            });
        } catch (_) {}

        if (existing) {
            const isSameVal = existing.value.trim().toLowerCase() === fact.value.trim().toLowerCase();
            const keyNeedsUpdate = existing.key !== fact.key;

            if (isSameVal && !keyNeedsUpdate) {
                console.log(`[Memory] Fact deduplicated (identical value exists). Updating timestamp: [${fact.category}] ${fact.key}`);
                await this.db.run(
                    `UPDATE knowledge SET timestamp = ? WHERE id = ?`,
                    [nowIso, existing.id]
                );
                return { success: true, action: "deduplicated", key: fact.key, value: fact.value, category: fact.category };
            }

            console.log(`[Memory] Fact updated (key: "${existing.key}" -> "${fact.key}"): "${existing.value}" -> "${fact.value}"`);
            await this.db.run(
                `UPDATE knowledge SET key = ?, value = ?, confidence = ?, timestamp = ?, category = ? WHERE id = ?`,
                [fact.key, fact.value, fact.confidence, nowIso, fact.category, existing.id]
            );

            // Vectorize updated fact
            if (this.vectorStore) {
                try {
                    const docText = `Fact [${fact.category}] ${fact.key.replace(/_/g, " ")}: ${fact.value}`;
                    const docObj = {
                        pageContent: docText,
                        metadata: {
                            id: existing.id,
                            chatId,
                            type: "KNOWLEDGE",
                            category: fact.category,
                            key: fact.key,
                            value: fact.value,
                            timestamp: nowIso
                        }
                    };
                    await this.vectorStore.addDocuments([docObj]);
                    this.persistSingleVector(docObj).catch(() => {});
                } catch (vErr: any) {
                    console.warn("[Memory] Vector sync warning for fact update:", vErr.message);
                }
            }

            return { success: true, action: "updated", key: fact.key, value: fact.value, category: fact.category };
        }

        // 2. Insert new structured fact
        const id = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        await new Promise<boolean>((resolve) => {
            this.db.run(
                `INSERT INTO knowledge (id, chat_id, category, key, value, confidence, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, chatId, fact.category, fact.key, fact.value, fact.confidence, nowIso],
                (err) => {
                    if (err) {
                        console.error("[Memory] Save Fact Error:", err.message);
                        resolve(false);
                    } else {
                        console.log(`[Memory] Saved Structured Fact -> [${chatId}][${fact.category}] ${fact.key}: "${fact.value}"`);
                        resolve(true);
                    }
                }
            );
        });

        // Vectorize new fact
        if (this.vectorStore) {
            try {
                const docText = `Fact [${fact.category}] ${fact.key.replace(/_/g, " ")}: ${fact.value}`;
                const docObj = {
                    pageContent: docText,
                    metadata: {
                        id,
                        chatId,
                        type: "KNOWLEDGE",
                        category: fact.category,
                        key: fact.key,
                        value: fact.value,
                        timestamp: nowIso
                    }
                };
                await this.vectorStore.addDocuments([docObj]);
                this.persistSingleVector(docObj).catch(() => {});
            } catch (vErr: any) {
                console.warn("[Memory] Vector sync warning for new fact:", vErr.message);
            }
        }

        return { success: true, action: "created", key: fact.key, value: fact.value, category: fact.category };
    }

    public async saveFact(
        category: string,
        key: string,
        value: string,
        confidenceOrChatId: number | string = 1.0,
        chatId: string = "default"
    ): Promise<boolean> {
        let confidence = 1.0;
        let actualChatId = chatId;
        if (typeof confidenceOrChatId === "string") {
            actualChatId = confidenceOrChatId;
        } else if (typeof confidenceOrChatId === "number") {
            confidence = confidenceOrChatId;
        }

        const fact: ExtractedFact = {
            category: (category as any) || "user_memory",
            key: FactExtractionEngine.toCleanSnakeCase(key, 32),
            value: value.trim(),
            confidence,
            rawStatement: `${key}: ${value}`,
            aliases: [key, FactExtractionEngine.toCleanSnakeCase(key, 32)]
        };
        const res = await this.saveStructuredFact(fact, actualChatId);
        return res.success;
    }

    public async getAllFacts(chatId: string = "default"): Promise<KnowledgeFact[]> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            // Strict multi-user isolation: return user's facts + global system facts only; never leak legacy 'default' user data
            const sql = chatId === "default"
                ? `SELECT * FROM knowledge WHERE chat_id = 'default' ORDER BY timestamp DESC, confidence DESC`
                : `SELECT * FROM knowledge WHERE chat_id = ? OR (chat_id = 'default' AND category = 'system') ORDER BY timestamp DESC, confidence DESC`;
            const params = chatId === "default" ? [] : [chatId];
            this.db.all<KnowledgeFact>(
                sql,
                params,
                (err, rows) => {
                    if (err || !rows) {
                        resolve([]);
                    } else {
                        const validRows = (rows as any).filter((r: any) => r && r.key && r.value && r.category);
                        resolve(validRows);
                    }
                }
            );
        });
    }

    private async extractFactsFromText(userInput: string, chatId: string = "default"): Promise<void> {
        // Questions and conversational pleasantries are not user facts to store in knowledge
        if (this.isQuestion(userInput) || this.classifyMessageIntent(userInput) === "CONVERSATION") {
            return;
        }
        try {
            const engine = FactExtractionEngine.getInstance();
            const extracted = await engine.extractFact(userInput);
            if (extracted && extracted.confidence >= 0.85 && extracted.value) {
                await this.saveStructuredFact(extracted, chatId);
            }
        } catch (e: any) {
            console.warn("[Memory] Automatic fact extraction warning:", e.message);
        }
    }

    private async persistSingleVector(doc: { pageContent: string; metadata: any }): Promise<void> {
        if (!this.db || this.db.getDriverName() !== "turso" || !this.vectorStore) return;
        try {
            const vecId = doc.metadata?.id || `vec_${Date.now()}`;
            const chatId = doc.metadata?.chatId || "default";
            const vecObj = this.vectorStore.memoryVectors.find((v: any) => v.metadata?.id === vecId);
            const embedding = vecObj?.embedding || [];
            if (embedding.length > 0) {
                await this.db.run(
                    `INSERT OR REPLACE INTO semantic_vectors (id, chat_id, content, metadata, embedding) VALUES (?, ?, ?, ?, ?)`,
                    [vecId, chatId, doc.pageContent, JSON.stringify(doc.metadata || {}), JSON.stringify(embedding)]
                );
            }
        } catch (e: any) {
            console.warn("[Memory] Warning persisting single vector to Turso:", e.message);
        }
    }

    // --- CONVERSATION HISTORY & QUESTION CLASSIFICATION ---

    public normalizeUserText(text: string): string {
        if (!text) return "";
        return text
            .normalize("NFKC")
            .trim()
            .replace(/^[\s"'`“”‘’«»„(\[{<]+/, "")
            .replace(/[\s"'`“”‘’«»„)\]}>,;:.]+$/, "")
            .trim();
    }

    public isQuestion(text: string): boolean {
        if (!text) return false;
        const trimmed = this.normalizeUserText(text);
        if (trimmed.endsWith("?")) return true;
        const lower = trimmed.toLowerCase();
        return /^(?:what|why|how|who|whom|whose|when|where|which|is|are|was|were|do|does|did|can|could|would|should|will|have|has|had|tell me|explain|can you|could you)\b/i.test(lower);
    }

    public isHistoryMetaQuestion(text: string): boolean {
        if (!text) return false;
        const lower = this.normalizeUserText(text).toLowerCase();
        return /\b(?:(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*questions?|what\s+(?:was|were)\s+(?:my|the)\s+(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five)?\s*questions?|what\s+did\s+i\s+(?:last\s+|just\s+|previously\s+)?ask|which\s+questions?\s+did\s+i\s+ask)\b/i.test(lower);
    }

    public classifyMessageIntent(text: string): "QUESTION" | "STATEMENT" | "COMMAND" | "CONVERSATION" {
        if (!text) return "CONVERSATION";
        const trimmed = this.normalizeUserText(text);
        const lower = trimmed.toLowerCase();

        // Conversational pleasantries (including greeting questions like "hello there, how are you?")
        if (/^(?:hi|hello|hey|greetings|howdy|good\s+(?:morning|afternoon|evening|night)|thanks|thank\s+you|bye|goodbye|ok|cool|nice)\b/i.test(trimmed)) {
            return "CONVERSATION";
        }
        if (/^(?:how\s+are\s+you(?:\s+doing)?|whats\s+up|what's\s+up|how\s+is\s+it\s+going)[\s!.,?]*$/i.test(trimmed)) {
            return "CONVERSATION";
        }

        // Directives & commands
        if (/^(?:remember|store|save|memorize|keep\s+in\s+mind|note\s+down|run|execute|generate|create|write|scrape|browse|set|update)\b/i.test(lower)) {
            return "COMMAND";
        }

        // Interrogatives & questions
        if (this.isQuestion(trimmed)) {
            return "QUESTION";
        }

        // Factual statements
        if (/^(?:my\s+[a-z0-9_\-\s]+?\s+is|i\s+am|i\s+study|i\s+work|i\s+prefer|i\s+like|our\s+[a-z0-9_\-\s]+?\s+is)\b/i.test(lower)) {
            return "STATEMENT";
        }

        return "CONVERSATION";
    }

    public async getRecentQuestions(
        chatId: string = "default",
        limit: number = 5,
        excludeId?: string
    ): Promise<Array<{ id: string; question: string; answer: string; timestamp: string }>> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            const sql = `SELECT id, user_msg, agent_res, timestamp FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC, id DESC, rowid DESC LIMIT 200`;
            this.db.all(sql, [chatId], (err, rows: any[]) => {
                if (err || !rows) return resolve([]);
                const questions = rows.filter(r => r && r.user_msg && r.id !== excludeId && this.isQuestion(r.user_msg) && !this.isHistoryMetaQuestion(r.user_msg));
                const slice = questions.slice(0, limit);
                // Return in chronological order (oldest to newest)
                resolve(slice.reverse().map(r => ({
                    id: r.id,
                    question: r.user_msg,
                    answer: r.agent_res,
                    timestamp: r.timestamp
                })));
            });
        });
    }

    public async getRecentMessages(
        chatId: string = "default",
        limit: number = 5
    ): Promise<Array<{ id: string; message: string; response: string; timestamp: string }>> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            const sql = `SELECT id, user_msg, agent_res, timestamp FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC, id DESC, rowid DESC LIMIT ?`;
            this.db.all(sql, [chatId, limit], (err, rows: any[]) => {
                if (err || !rows) return resolve([]);
                // Return in chronological order (oldest to newest)
                resolve(rows.reverse().map(r => ({
                    id: r.id,
                    message: r.user_msg,
                    response: r.agent_res,
                    timestamp: r.timestamp
                })));
            });
        });
    }

    // --- LOCAL RELEVANCE RANKING ---

    private calculateJaccardSimilarity(textA: string, textB: string): number {
        const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        if (wordsA.size === 0 || wordsB.size === 0) return 0;

        let intersection = 0;
        wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });
        return intersection / (wordsA.size + wordsB.size - intersection);
    }

    private rankContentByRelevance(query: string, items: { text: string; score?: number }[]): { text: string; score: number }[] {
        return items
            .map(item => {
                const jaccard = this.calculateJaccardSimilarity(query, item.text);
                const baseScore = item.score || 0.5;
                return { text: item.text, score: baseScore * 0.7 + jaccard * 0.3 };
            })
            .sort((a, b) => b.score - a.score);
    }

    // --- MEMORY SEARCH ENGINE ---

    public async searchMemory(query: string, chatId: string = "default"): Promise<string> {
        await this.initialize().catch(() => { });
        const results: string[] = [];
        const lowerQ = query.toLowerCase().trim();

        // 1. Check for History Retrieval Queries (Last N Questions or Last N Messages)
        const isQuestionHistory = /\b(?:(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*questions?|what\s+(?:was|were)\s+(?:my|the)\s+(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five)?\s*questions?|what\s+did\s+i\s+(?:last\s+|just\s+|previously\s+)?ask|which\s+questions?\s+did\s+i\s+ask)\b/i.test(lowerQ);
        const isMessageHistory = !isQuestionHistory && /\b(?:(?:last|previous|recent|earlier)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:messages?|chats?|turns?|texts?)|what\s+did\s+i\s+(?:just\s+)?say|conversation\s+history)\b/i.test(lowerQ);

        if (isQuestionHistory) {
            let limit = 1;
            const digitMatch = lowerQ.match(/\b(?:last|previous|recent|earlier)\s+(\d+)\b/i);
            if (digitMatch) {
                limit = parseInt(digitMatch[1], 10);
            } else {
                const wordMap: Record<string, number> = {
                    one: 1, two: 2, three: 3, four: 4, five: 5,
                    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
                };
                const wordMatch = lowerQ.match(/\b(?:last|previous|recent|earlier)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
                if (wordMatch) {
                    limit = wordMap[wordMatch[1].toLowerCase()] || 2;
                } else if (/\b(?:questions|recent\s+questions)\b/i.test(lowerQ) && !/\b(?:last\s+question|previous\s+question)\b/i.test(lowerQ)) {
                    limit = 5;
                }
            }
            const questions = await this.getRecentQuestions(chatId, limit);
            if (questions.length === 0) {
                return `No previous questions found in conversation history for this chat.`;
            }
            return `[CONVERSATION HISTORY - RECENT QUESTIONS (Chronological)]\n` +
                questions.map((q, idx) => `${idx + 1}. [${q.timestamp || 'Recent'}] User asked: "${q.question}"\n   Bot answered: "${q.answer}"`).join("\n\n");
        }

        if (isMessageHistory) {
            let limit = 5;
            const digitMatch = lowerQ.match(/\b(?:last|previous|recent|earlier)\s+(\d+)\b/i);
            if (digitMatch) {
                limit = parseInt(digitMatch[1], 10);
            } else {
                const wordMap: Record<string, number> = {
                    one: 1, two: 2, three: 3, four: 4, five: 5,
                    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
                };
                const wordMatch = lowerQ.match(/\b(?:last|previous|recent|earlier)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
                if (wordMatch) {
                    limit = wordMap[wordMatch[1].toLowerCase()] || 2;
                } else if (/\b(?:last\s+message|previous\s+message)\b/i.test(lowerQ)) {
                    limit = 1;
                }
            }
            const msgs = await this.getRecentMessages(chatId, limit);
            if (msgs.length === 0) {
                return `No recent messages found in conversation history for this chat.`;
            }
            return `[CONVERSATION HISTORY - RECENT MESSAGES (Chronological)]\n` +
                msgs.map((m, idx) => `${idx + 1}. [${m.timestamp || 'Recent'}] User: "${m.message}"\n   Bot: "${m.response}"`).join("\n\n");
        }

        const facts = await this.getAllFacts(chatId);
        const isNameQuery = lowerQ === "user_name" || /\b(?:name|who am i|user_name)\b/i.test(lowerQ);

        const stopWords = new Set([
            "my", "the", "a", "an", "about", "did", "i", "save", "what", "is", "for", 
            "please", "me", "and", "or", "tell", "show", "can", "you", "your",
            "do", "have", "any", "know", "with", "which", "are", "in", "to", "called",
            "named", "titled", "remember", "stored", "recall"
        ]);

        const queryWords = lowerQ
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => !stopWords.has(w) && w.length > 2);

        // 2. Comprehensive Synonym & Concept Expansion
        const expandedQueryWords = new Set<string>(queryWords);
        const synonymGroups: string[][] = [
            ["sample", "demo", "example", "test", "prototype", "trial"],
            ["project", "app", "application", "software", "codebase", "system", "tool", "program"],
            ["name", "called", "named", "titled", "alias", "known"],
            ["favorite", "favourite", "preferred", "liked", "best", "choice"],
            ["language", "lang", "programming language", "code"],
            ["database", "db", "storage", "datastore"],
            ["platform", "host", "hosting", "deployment", "server", "cloud"],
            ["college", "university", "institute", "school", "campus", "study", "studying", "student", "education", "degree", "attending", "attend"],
            ["work", "working", "job", "company", "employer", "office", "career", "profession", "occupation"],
            ["live", "living", "reside", "residing", "location", "city", "hometown", "home", "address", "country", "place"],
            ["year", "academic year", "class"]
        ];

        for (const group of synonymGroups) {
            if (group.some(word => queryWords.includes(word))) {
                group.forEach(w => expandedQueryWords.add(w));
            }
        }

        const matchingFacts = facts.filter(f => {
            const keyLower = f.key.toLowerCase().replace(/_/g, " ");
            const valLower = f.value.toLowerCase();
            const catLower = f.category.toLowerCase();
            const fullText = `${catLower} ${keyLower} ${valLower}`;

            // Exact phrase match
            if (fullText.includes(lowerQ)) return true;

            // Token overlap match: matches if any distinctive keyword is in the fact
            if (expandedQueryWords.size > 0) {
                const matchedWords = Array.from(expandedQueryWords).filter(w => fullText.includes(w));
                return matchedWords.length > 0;
            }

            return false;
        });

        // 3. Dense Vector Similarity Search for Facts & Conversation
        if (this.vectorStore) {
            try {
                let timer: NodeJS.Timeout;
                const timeoutPromise = new Promise<any[]>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("VECTOR_SEARCH_TIMEOUT")), 5000);
                });
                const vecDocs = await Promise.race([
                    this.vectorStore.similaritySearch(query, 6),
                    timeoutPromise
                ]).finally(() => clearTimeout(timer!));

                const userVecDocs = vecDocs ? vecDocs.filter(d => {
                    if (d.metadata?.isDoc) return true;
                    if (chatId === "default") return !d.metadata?.chatId || d.metadata.chatId === "default";
                    return d.metadata?.chatId === chatId;
                }) : [];

                if (userVecDocs && userVecDocs.length > 0) {
                    for (const doc of userVecDocs) {
                        if (doc.metadata?.type === "KNOWLEDGE" && doc.metadata?.key) {
                            if (!matchingFacts.some(f => f.key === doc.metadata.key)) {
                                matchingFacts.push({
                                    id: doc.metadata.id || "vec_fact",
                                    chat_id: chatId,
                                    category: doc.metadata.category || "user_memory",
                                    key: doc.metadata.key,
                                    value: doc.metadata.value || doc.pageContent,
                                    confidence: 0.9,
                                    timestamp: doc.metadata.timestamp || new Date().toISOString()
                                });
                            }
                        }
                    }
                    results.push(`[SEMANTIC_MEMORY MATCHES]\n` + userVecDocs.map(d => docToText(d)).join("\n---\n"));
                }
            } catch (e: any) {
                console.log('[Memory] Vector search unavailable — using SQLite only.');
            }
        }

        // Sort matching facts by number of matching keywords descending
        matchingFacts.sort((a, b) => {
            const aText = `${a.category} ${a.key.replace(/_/g, " ")} ${a.value}`.toLowerCase();
            const bText = `${b.category} ${b.key.replace(/_/g, " ")} ${b.value}`.toLowerCase();
            const aMatches = Array.from(expandedQueryWords).filter(w => aText.includes(w)).length;
            const bMatches = Array.from(expandedQueryWords).filter(w => bText.includes(w)).length;
            return bMatches - aMatches;
        });

        if (isNameQuery) {
            const nameFacts = facts.filter(f => f.key.toLowerCase().includes("name") || f.category === "user_profile");
            for (const nf of nameFacts) {
                if (!matchingFacts.some(existing => existing.id === nf.id)) {
                    matchingFacts.push(nf);
                }
            }
        }

        if (matchingFacts.length > 0) {
            results.push(`[USER_FACTS MATCHES]\n` + matchingFacts.map(f => `• [${f.category}] ${f.key}: ${f.value}`).join("\n"));
        }

        // 4. Conversation Turns Match
        const interactions = await new Promise<any[]>((resolve) => {
            const sql = chatId === "default"
                ? `SELECT user_msg, agent_res FROM interactions WHERE chat_id = 'default' AND (user_msg LIKE ? OR agent_res LIKE ?) ORDER BY timestamp DESC LIMIT 5`
                : `SELECT user_msg, agent_res FROM interactions WHERE chat_id = ? AND (user_msg LIKE ? OR agent_res LIKE ?) ORDER BY timestamp DESC LIMIT 5`;
            const params = chatId === "default" ? [`%${query}%`, `%${query}%`] : [chatId, `%${query}%`, `%${query}%`];
            this.db.all(
                sql,
                params,
                (err, rows) => {
                    resolve(rows || []);
                }
            );
        });

        if (interactions.length > 0) {
            results.push(`[CONVERSATION MATCHES]\n` + interactions.map(i => `User: ${i.user_msg}\nAgent: ${i.agent_res}`).join("\n\n"));
        }

        return results.length > 0 ? results.join("\n\n") : `No memory records found matching query: "${query}"`;
    }

    // --- LAYER 4: SUMMARIZATION ---

    private async checkAndSummarizeOldInteractions(): Promise<void> {
        try {
            const count: number = await new Promise((resolve) => {
                this.db.get<{ total: number }>(`SELECT COUNT(*) as total FROM interactions`, [], (err, row) => {
                    resolve(row ? row.total : 0);
                });
            });

            if (count > 0 && count % 50 === 0) {
                console.log(`[Memory] Auto-summarization triggered at ${count} interactions...`);
                const rows = await new Promise<any[]>((resolve) => {
                    this.db.all(`SELECT * FROM interactions ORDER BY timestamp ASC LIMIT 50`, [], (err, r) => resolve(r || []));
                });

                if (rows.length >= 50) {
                    const transcript = rows.map(r => `User: ${r.user_msg}\nAgent: ${r.agent_res}`).join("\n\n");
                    const prompt = `Summarize the key decisions, user facts, and topics discussed in this conversation transcript concise bullet points:\n\n${transcript}`;

                    const router = ModelRouter.getInstance();
                    const summaryRes = await router.invoke([
                        new SystemMessage("You are an expert conversation summarizer."),
                        new HumanMessage(prompt)
                    ], "summarizer");

                    const summaryText = summaryRes.content as string;
                    const sumId = `sum_${Date.now()}`;

                    await new Promise<void>((resolve) => {
                        this.db.run(
                            `INSERT INTO summaries (id, from_interaction, to_interaction, summary_text) VALUES (?, ?, ?, ?)`,
                            [sumId, 1, 50, summaryText],
                            () => resolve()
                        );
                    });
                    console.log(`[Memory] Auto-summarization complete.`);
                }
            }
        } catch (e: any) {
            console.warn("[Memory] Summarization skipped:", e.message);
        }
    }

    // --- HELPER METHODS FOR PARALLEL EXECUTION & CACHING ---

    public async getRecentHistory(chatId: string = "default"): Promise<any[]> {
        return new Promise<any[]>((resolve) => {
            this.db.all(
                `SELECT user_msg, agent_res FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 20`,
                [chatId],
                (err, rows) => {
                    if (err || !rows) resolve([]);
                    else resolve(rows.reverse());
                }
            );
        });
    }

    public async getRelevantSummaries(): Promise<any[]> {
        return new Promise<any[]>((resolve) => {
            this.db.all(`SELECT summary_text FROM summaries ORDER BY timestamp DESC LIMIT 3`, [], (err, rows) => {
                if (err || !rows) resolve([]);
                else resolve(rows);
            });
        });
    }

    public async getSemanticContext(userInput: string, chatId?: string): Promise<string> {
        if (!this.vectorStore || !userInput) return "";
        try {
            const cacheKey = userInput.substring(0, 100);
            if (this.embeddingCache.has(cacheKey)) {
                const results = await this.vectorStore.similaritySearch(userInput, 15);
                const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
                return ranked.slice(0, 8).map(r => r.text).join("\n---\n");
            }

            if (this.embeddingCache.size > 50) {
                const keysToDelete = Array.from(this.embeddingCache.keys()).slice(0, 10);
                keysToDelete.forEach(k => this.embeddingCache.delete(k));
            }

            const results = await this.vectorStore.similaritySearch(userInput, 15);
            this.embeddingCache.set(cacheKey, [1]);
            const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
            return ranked.slice(0, 8).map(r => r.text).join("\n---\n");
        } catch (e: any) {
            console.log('[Memory] Vector search unavailable — using SQLite only.');
            return "";
        }
    }

    // --- INTERACTION & CONTEXT ASSEMBLY ---

        public async getRecentTurns(chatId: string = "default", limit: number = 10): Promise<{ user_msg: string; agent_res: string }[]> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            this.db.all(
                `SELECT user_msg, agent_res FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC, id DESC, rowid DESC LIMIT ?`,
                [chatId, limit],
                (err, rows: any[]) => {
                    if (err || !rows) resolve([]);
                    else resolve(rows.reverse());
                }
            );
        });
    }

    public async addInteraction(userInput: string, agentResponse: string, chatId: string = "default"): Promise<void> {
        await this.initialize().catch(() => { });
        const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return new Promise((resolve, reject) => {
            this.db.run(
                "INSERT INTO interactions (id, chat_id, user_msg, agent_res) VALUES (?, ?, ?, ?)",
                [id, chatId, userInput, agentResponse],
                async (err) => {
                    if (err) {
                        console.error("[Memory] Add Interaction Error:", err.message);
                        reject(err);
                    } else {
                        if (this.vectorStore) {
                            try {
                                const combinedDoc = `User: ${userInput}\nAgent: ${agentResponse}`;
                                const newDoc = {
                                    pageContent: combinedDoc,
                                    metadata: {
                                        id,
                                        chatId,
                                        userInput,
                                        agentResponse,
                                        type: "CONVERSATION",
                                        timestamp: new Date().toISOString()
                                    }
                                };
                                await this.vectorStore.addDocuments([newDoc]);
                                this.persistSingleVector(newDoc).catch(() => {});
                            } catch (vErr: any) {
                                console.warn("[Memory] Vector Embedding Error (Ignored for interaction save):", vErr.message);
                            }
                        }

                        await this.extractFactsFromText(userInput, chatId);
                        await this.checkAndSummarizeOldInteractions();

                        // Background GraphRAG Relation Extraction (Non-blocking)
                        extractAndStoreTriples(userInput, chatId)
                            .then((count) => {
                                if (count > 0) {
                                    console.log(`[Memory] Background GraphRAG stored ${count} new triples.`);
                                }
                            })
                            .catch((e) => console.warn("[Memory] Background GraphRAG extraction skipped:", e.message));

                        resolve();
                    }
                }
            );
        });
    }

    // --- TIMEOUT ISOLATION HELPER FOR 4-TIER MEMORY LAYERS ---
    private async executeLayerWithTimeout<T>(
        layerName: string,
        fetcher: (signal: AbortSignal) => Promise<T>,
        fallback: T,
        timeoutMs: number = 6000
    ): Promise<{ data: T; durationMs: number; timedOut: boolean }> {
        const controller = new AbortController();
        const t0 = Date.now();
        let timer: NodeJS.Timeout;

        const timeoutPromise = new Promise<{ data: T; durationMs: number; timedOut: boolean }>((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                const duration = Date.now() - t0;
                console.warn(`[Memory] ${layerName} timed out after ${timeoutMs}ms — skipping`);
                resolve({ data: fallback, durationMs: duration, timedOut: true });
            }, timeoutMs);
        });

        try {
            const result = await Promise.race([
                fetcher(controller.signal).then(d => {
                    clearTimeout(timer);
                    return { data: d, durationMs: Date.now() - t0, timedOut: false };
                }),
                timeoutPromise
            ]);
            return result;
        } catch (err: any) {
            clearTimeout(timer!);
            const duration = Date.now() - t0;
            console.warn(`[Memory] ${layerName} Error: ${err.message}`);
            return { data: fallback, durationMs: duration, timedOut: false };
        }
    }

    // --- FAILURE ISOLATED CONTEXT ASSEMBLY ---

    public async getContext(userInput: string, chatId: string = "default", parentSignal?: AbortSignal): Promise<string> {
        try {
            await this.initialize().catch(() => { });

            if (parentSignal?.aborted) {
                return "No previous context available (Flow Aborted).";
            }

            const seedKeywords = Array.from(new Set(
                userInput
                    .replace(/[^a-zA-Z0-9\s]/g, "")
                    .split(/\s+/)
                    .filter(w => w.length > 3)
                    .concat(["User"])
            ));

            const kg = KnowledgeGraphManager.getInstance();

            // Execute EACH of the 4 memory layers in its own 6-second timeout with AbortController
            const [l1, l2, l3, l4, lKg] = await Promise.all([
                this.executeLayerWithTimeout("Layer 1 (Recent History)", () => this.getRecentHistory(chatId), []),
                this.executeLayerWithTimeout("Layer 2 (Vector Search)", () => this.getSemanticContext(userInput), ""),
                this.executeLayerWithTimeout("Layer 3 (Knowledge Facts)", () => this.getAllFacts(chatId), []),
                this.executeLayerWithTimeout("Layer 4 (Summaries)", () => this.getRelevantSummaries(), []),
                this.executeLayerWithTimeout("GraphRAG", () => kg.traverseSubGraph(seedKeywords, 2), { seedEntities: [], visitedEntities: [], triples: [] })
            ]);

            const perLayerLog = `Layer 1 (Recent History): ${l1.durationMs}ms | Layer 2 (Vector Search): ${l2.durationMs}ms | Layer 3 (Knowledge Facts): ${l3.durationMs}ms | Layer 4 (Summaries): ${l4.durationMs}ms | GraphRAG: ${lKg.durationMs}ms`;
            console.log(`[Memory] Retrieval Breakdown: ${perLayerLog}`);
            DashboardLogger.log(`[Memory] Retrieval Breakdown: ${perLayerLog}`);

            const recentRows = l1.data;
            const semanticText = l2.data;
            const facts = l3.data;
            const summaryRows = l4.data;
            const graphData = lKg.data;

            let knowledgeText = "";
            if (facts.length > 0) {
                knowledgeText = facts.map(f => `- ${f.key} (${f.category}): ${f.value}`).join("\n");
            }

            let recentText = "";
            if (recentRows.length > 0) {
                recentText = recentRows.map(r => `User: ${r.user_msg}\nAgent: ${r.agent_res}`).join("\n\n");
            }

            let summariesText = "";
            if (summaryRows.length > 0) {
                summariesText = summaryRows.map(s => `- ${s.summary_text}`).join("\n");
            }

            const graphText = kg.formatGraphContextForLLM(graphData);

            const sections: string[] = [];

            if (recentText.trim()) {
                sections.push(`[CONVERSATION RECENT HISTORY (LAST 20)]\n${recentText.trim()}`);
            }

            if (knowledgeText.trim()) {
                sections.push(`[USER_FACTS & KNOWLEDGE BASE]\n${knowledgeText.trim()}`);
            }

            if (graphText && graphText.trim()) {
                sections.push(`=== KNOWLEDGE GRAPH CONNECTIONS (GraphRAG) ===\n${graphText.trim()}`);
            }

            if (summariesText.trim()) {
                sections.push(`[SUMMARY CONVERSATIONS]\n${summariesText.trim()}`);
            }

            if (semanticText.trim()) {
                sections.push(`[SEMANTIC_MEMORIES RELEVANT MATCHES]\n${semanticText.trim()}`);
            }

            const combined = sections.join("\n\n");

            const contextLimit = 8000;
            return combined.length > contextLimit ? combined.substring(0, contextLimit) + "\n[CONTEXT TRUNCATED]" : combined;
        } catch (fatalErr: any) {
            console.error("[Memory] Critical getContext failure safely caught:", fatalErr.message);
            return "No previous context available.";
        }
    }

    public async ingestDocument(text: string, source: string): Promise<void> {
        await this.initialize().catch(() => { });
        if (!this.vectorStore) return;
        try {
            console.log(`[Memory] Ingesting document into vector store from: ${source}`);
            const id = `doc_${Date.now()}`;
            await this.vectorStore.addDocuments([
                {
                    pageContent: text,
                    metadata: { source, id, type: "KNOWLEDGE", isDoc: true, timestamp: new Date().toISOString() }
                }
            ]);
            await this.saveVectorStore();
        } catch (error: any) {
            console.error("[Memory] Document Ingestion Error:", error.message);
        }
    }

    public async clearHistory(chatId: string = "default"): Promise<void> {
        await this.initialize().catch(() => { });
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM interactions WHERE chat_id = ?`, [chatId], async (err) => {
                if (err) reject(err);
                else {
                    console.log(`[Memory] History cleared for chat_id: ${chatId}`);
                    resolve();
                }
            });
        });
    }

    public async clearAllMemory(): Promise<void> {
        await this.initialize().catch(() => { });
        return new Promise((resolve, reject) => {
            this.db.serialize(async () => {
                this.db.run(`DELETE FROM interactions;`);
                this.db.run(`DELETE FROM knowledge;`);
                this.db.run(`DELETE FROM summaries;`);

                if (this.vectorStore) {
                    this.vectorStore.memoryVectors = [];
                    await this.saveVectorStore();
                }

                try {
                    await fs.unlink(this.storagePath);
                } catch (e) { }

                console.log("[Memory] All memory layers wiped cleanly.");
                resolve();
            });
        });
    }

    public async getStats(): Promise<{ interactions: number; facts: number; summaries: number; vectors: number }> {
        await this.initialize().catch(() => {});
        const interactions: number = await new Promise(res => this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM interactions`, [], (e, r) => res(r ? r.c : 0)));
        const facts: number = await new Promise(res => this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM knowledge`, [], (e, r) => res(r ? r.c : 0)));
        const summaries: number = await new Promise(res => this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM summaries`, [], (e, r) => res(r ? r.c : 0)));
        const vectors = this.vectorStore ? this.vectorStore.memoryVectors.length : 0;

        return { interactions, facts, summaries, vectors };
    }

    public async checkHealth(): Promise<{ sqlite: { status: string; details: string }; chroma: { status: string; details: string } }> {
        const stats = await this.getStats().catch(() => ({ vectors: 0 }));
        const sqliteStatus = this.db ? "connected" : "error";
        const sqliteDetails = this.db ? "SQLite Database Connected." : "SQLite Database Connection failed.";
        const chromaStatus = this.vectorStore ? "connected" : "offline";
        const chromaDetails = this.vectorStore ? `Vector store active with ${stats.vectors} semantic vectors.` : "Vector store offline.";

        return {
            sqlite: { status: sqliteStatus, details: sqliteDetails },
            chroma: { status: chromaStatus, details: chromaDetails }
        };
    }

    public async migrateLegacyDefaultUser(targetChatId: string): Promise<{ migratedFacts: number; migratedInteractions: number }> {
        await this.initialize().catch(() => {});
        if (!targetChatId || targetChatId === "default") {
            throw new Error("Target chatId must be a valid non-default identifier.");
        }

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(
                    `UPDATE OR IGNORE knowledge SET chat_id = ? WHERE chat_id = 'default' AND category IN ('user_profile', 'user_memory', 'preference')`,
                    [targetChatId],
                    function (err) {
                        if (err) return reject(err);
                        const factsCount = this.changes;

                        this.db.run(
                            `UPDATE interactions SET chat_id = ? WHERE chat_id = 'default'`,
                            [targetChatId],
                            function (err2) {
                                if (err2) return reject(err2);
                                resolve({ migratedFacts: factsCount, migratedInteractions: this.changes });
                            }
                        );
                    }
                );
            });
        });
    }

    private async saveVectorStore(): Promise<void> {
        if (!this.vectorStore) return;
        try {
            const vectors = this.vectorStore.memoryVectors.map(v => ({
                content: v.content,
                metadata: v.metadata,
                embedding: v.embedding
            }));

            // If Turso cloud driver is active, persist to semantic_vectors table
            if (this.db && this.db.getDriverName() === "turso") {
                const stmts = vectors.map((v, idx) => ({
                    sql: `INSERT OR REPLACE INTO semantic_vectors (id, chat_id, content, metadata, embedding) VALUES (?, ?, ?, ?, ?)`,
                    params: [
                        v.metadata?.id || `vec_${idx}_${Date.now()}`,
                        v.metadata?.chatId || "default",
                        v.content || "",
                        JSON.stringify(v.metadata || {}),
                        JSON.stringify(v.embedding || [])
                    ]
                }));
                // Batch insert into Turso
                for (let i = 0; i < stmts.length; i += 25) {
                    await this.db.batch(stmts.slice(i, i + 25)).catch(e => {
                        console.warn("[Memory] Warning persisting vectors to Turso:", e.message);
                    });
                }
            }

            // Also persist to local file for fast boot cache
            await fs.writeFile(this.storagePath, JSON.stringify(vectors, null, 2)).catch(() => {});
        } catch (err: any) {
            console.error("[Memory] Failed to save semantic core:", err.message);
        }
    }
}

function docToText(doc: any): string {
    return doc ? doc.pageContent || JSON.stringify(doc) : "";
}

export const memory = MemoryManager.getInstance();
