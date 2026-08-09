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

dotenv.config();

interface SerializedVector {
    content: string;
    metadata: any;
    embedding: number[];
}

export interface KnowledgeFact {
    id: string;
    category: string;
    key: string;
    value: string;
    confidence: number;
    timestamp: string;
}

export type MemoryType = "USER_FACT" | "CONVERSATION" | "KNOWLEDGE" | "SUMMARY";

export class MemoryManager {
    private static instance: MemoryManager;
    private db: sqlite3.Database;
    private vectorStore: MemoryVectorStore | null = null;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private storagePath: string = path.join(__dirname, "semantic_core.json");
    private isInitialized: boolean = false;
    private embeddingCache = new Map<string, number[]>();

    private constructor() {
        this.db = new sqlite3.Database("./openclaw.db", (err) => {
            if (err) {
                console.error("[Memory] SQLite Connection Error:", err.message);
            } else {
                console.log("[Memory] SQLite Connected.");
            }
        });

        this.embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_API_KEY!,
            modelName: "embedding-001",
        });
    }

    public static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
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
                `);

                this.db.run(`PRAGMA table_info(interactions)`, (err, rows) => {
                    this.db.run(`ALTER TABLE interactions ADD COLUMN chat_id TEXT DEFAULT 'default'`, () => {});
                });

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS knowledge (
                        id TEXT PRIMARY KEY,
                        category TEXT,
                        key TEXT UNIQUE,
                        value TEXT,
                        confidence REAL DEFAULT 1.0,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS summaries (
                        id TEXT PRIMARY KEY,
                        from_interaction INTEGER,
                        to_interaction INTEGER,
                        summary_text TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    private async initVectorStore(): Promise<void> {
        try {
            try {
                const data = await fs.readFile(this.storagePath, "utf-8");
                const serialized: SerializedVector[] = JSON.parse(data);

                this.vectorStore = new MemoryVectorStore(this.embeddings);

                if (serialized && Array.isArray(serialized)) {
                    console.log(`[Memory] Loading ${serialized.length} semantic vectors from disk...`);
                    const docs = serialized.map(item => ({
                        pageContent: item.content,
                        metadata: item.metadata
                    }));
                    await this.vectorStore.addDocuments(docs);
                }
            } catch (e) {
                console.log("[Memory] No existing semantic core found. Starting fresh.");
                this.vectorStore = new MemoryVectorStore(this.embeddings);
            }
            console.log("[Memory] 4-Layer Vector Store initialized.");
        } catch (error: any) {
            console.warn("[Memory] Vector Core initialization failed (Fallback Active):", error.message);
        }
    }

    // --- FACT MANAGEMENT (DEDUPLICATION & CONFLICT RESOLUTION) ---

    public async saveFact(category: string, key: string, value: string, confidence: number = 1.0): Promise<boolean> {
        await this.initialize().catch(() => {});
        const id = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

        const existing: KnowledgeFact | null = await new Promise((resolve) => {
            this.db.get<KnowledgeFact>(`SELECT * FROM knowledge WHERE key = ?`, [key], (err, row) => resolve(row || null));
        });

        if (existing) {
            if (existing.value.trim().toLowerCase() === value.trim().toLowerCase()) {
                console.log(`[Memory] Fact deduplicated (identical value exists): [${category}] ${key} = "${value}"`);
                return true;
            }
            console.log(`[Memory] Fact updated (conflict resolved): [${category}] ${key}: "${existing.value}" -> "${value}"`);
            return new Promise((resolve) => {
                this.db.run(
                    `UPDATE knowledge SET value = ?, confidence = ?, timestamp = CURRENT_TIMESTAMP WHERE key = ?`,
                    [value, confidence, key],
                    (err) => resolve(!err)
                );
            });
        }

        return new Promise((resolve) => {
            this.db.run(
                `INSERT INTO knowledge (id, category, key, value, confidence, timestamp) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [id, category, key, value, confidence],
                (err) => {
                    if (err) {
                        console.error("[Memory] Save Fact Error:", err.message);
                        resolve(false);
                    } else {
                        console.log(`[Memory] Saved Fact -> [${category}] ${key}: "${value}"`);
                        resolve(true);
                    }
                }
            );
        });
    }

    public async getAllFacts(): Promise<KnowledgeFact[]> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            this.db.all<KnowledgeFact>(`SELECT * FROM knowledge ORDER BY timestamp DESC`, [], (err, rows) => {
                if (err || !rows) resolve([]);
                else resolve(rows);
            });
        });
    }

    private async extractFactsFromText(userInput: string): Promise<void> {
        const text = userInput.trim();

        const nameMatch = text.match(/(?:my name is|i am|call me)\s+([A-Z][a-zA-Z]+)/i);
        if (nameMatch && nameMatch[1] && !["a", "the", "building", "working", "going"].includes(nameMatch[1].toLowerCase())) {
            await this.saveFact("user_profile", "user_name", nameMatch[1].trim());
        }

        const studentMatch = text.match(/(?:i am a|i am an|studying|student of)\s+([a-zA-Z\s]+?)\s+(?:student|degree|dept|department)/i);
        if (studentMatch && studentMatch[1]) {
            await this.saveFact("user_profile", "student_type", studentMatch[1].trim());
        }

        const collegeMatch = text.match(/(?:at|from|in|study at|studying at)\s+([A-Za-z0-9\s]+?)\s+(?:college|university|institute|institution|school)/i);
        if (collegeMatch && collegeMatch[1]) {
            const collegeName = `${collegeMatch[1].trim()} College`;
            await this.saveFact("user_profile", "college", collegeName);
        }

        const yearMatch = text.match(/(final|1st|2nd|3rd|4th|first|second|third|fourth)\s+year/i);
        if (yearMatch) {
            await this.saveFact("user_profile", "year", `${yearMatch[1].toLowerCase()} year`);
        }

        const projectMatch = text.match(/(?:my project is|building|working on|developing)\s+([A-Za-z0-9\s\-_]+?)(?:\.|,|\s+as|\s+for|$)/i);
        if (projectMatch && projectMatch[1] && projectMatch[1].length > 3) {
            await this.saveFact("project", "project_name", projectMatch[1].trim());
        }

        const prefMatch = text.match(/(?:i prefer|i like|i love)\s+([A-Za-z0-9\s\-_]+?)(?:\.|,|$)/i);
        if (prefMatch && prefMatch[1]) {
            await this.saveFact("preference", `pref_${Date.now()}`, prefMatch[1].trim());
        }
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

    public async searchMemory(query: string): Promise<string> {
        await this.initialize().catch(() => {});
        const results: string[] = [];

        const facts = await this.getAllFacts();
        const matchingFacts = facts.filter(f =>
            f.key.toLowerCase().includes(query.toLowerCase()) ||
            f.value.toLowerCase().includes(query.toLowerCase()) ||
            f.category.toLowerCase().includes(query.toLowerCase())
        );

        if (matchingFacts.length > 0) {
            results.push(`[USER_FACTS MATCHES]\n` + matchingFacts.map(f => `• [${f.category}] ${f.key}: ${f.value}`).join("\n"));
        }

        const interactions = await new Promise<any[]>((resolve) => {
            this.db.all(`SELECT user_msg, agent_res FROM interactions WHERE user_msg LIKE ? OR agent_res LIKE ? LIMIT 5`, [`%${query}%`, `%${query}%`], (err, rows) => {
                resolve(rows || []);
            });
        });

        if (interactions.length > 0) {
            results.push(`[CONVERSATION MATCHES]\n` + interactions.map(i => `User: ${i.user_msg}\nAgent: ${i.agent_res}`).join("\n\n"));
        }

        if (this.vectorStore) {
            try {
                const vecDocs = await this.vectorStore.similaritySearch(query, 5);
                if (vecDocs && vecDocs.length > 0) {
                    results.push(`[SEMANTIC_MEMORY MATCHES]\n` + vecDocs.map(d => docToText(d)).join("\n---\n"));
                }
            } catch (e: any) {
                console.warn("[Memory] Vector search error in searchMemory (Fallback Active):", e.message);
            }
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

    public async getSemanticContext(userInput: string): Promise<string> {
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
            console.warn("[Memory] Vector embedding/search offline (Fallback to SQLite Facts):", e.message);
            return "";
        }
    }

    // --- INTERACTION & CONTEXT ASSEMBLY ---

    public async addInteraction(arg1: string, arg2: string, arg3: string = "default"): Promise<void> {
        await this.initialize().catch(() => {});
        const id = `msg_${Date.now()}`;

        let userInput = arg1;
        let agentResponse = arg2;
        let chatId = arg3;

        if ((/^\d+$/.test(arg1) || arg1 === "default") && arg2 && arg3 !== "default") {
            chatId = arg1;
            userInput = arg2;
            agentResponse = arg3;
        }

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
                                await this.vectorStore.addDocuments([
                                    {
                                        pageContent: combinedDoc,
                                        metadata: {
                                            id,
                                            chatId,
                                            userInput,
                                            agentResponse,
                                            type: "CONVERSATION",
                                            timestamp: new Date().toISOString()
                                        }
                                    }
                                ]);
                                await this.saveVectorStore();
                            } catch (vErr: any) {
                                console.warn("[Memory] Vector Embedding Error (Ignored for interaction save):", vErr.message);
                            }
                        }

                        await this.extractFactsFromText(userInput);
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

    // --- FAILURE ISOLATED CONTEXT ASSEMBLY ---

    public async getContext(arg1: string, arg2: string = "default"): Promise<string> {
        try {
            await this.initialize().catch(() => {});

            let userInput = arg1;
            let chatId = arg2;

            if ((/^\d+$/.test(arg1) || arg1 === "default") && arg2 && arg2 !== "default") {
                chatId = arg1;
                userInput = arg2;
            }

            const seedKeywords = Array.from(new Set(
                userInput
                    .replace(/[^a-zA-Z0-9\s]/g, "")
                    .split(/\s+/)
                    .filter(w => w.length > 3)
                    .concat(["User"])
            ));

            const kg = KnowledgeGraphManager.getInstance();

            const [facts, recentRows, summaryRows, semanticText, graphData] = await Promise.all([
                this.getAllFacts().catch(e => { console.warn("[Memory] Layer 3 Knowledge Fact Fetch Error:", e.message); return []; }),
                this.getRecentHistory(chatId).catch(e => { console.warn("[Memory] Layer 1 Recent History Fetch Error:", e.message); return []; }),
                this.getRelevantSummaries().catch(e => { console.warn("[Memory] Layer 4 Summary Fetch Error:", e.message); return []; }),
                this.getSemanticContext(userInput).catch(e => { console.warn("[Memory] Layer 2 Vector Search Fetch Error:", e.message); return ""; }),
                kg.traverseSubGraph(seedKeywords, 2).catch(e => { console.warn("[Memory] GraphRAG Fetch Error:", e.message); return { seedEntities: [], visitedEntities: [], triples: [] }; })
            ]);

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

            if (knowledgeText.trim()) {
                sections.push(`[USER_FACTS & KNOWLEDGE BASE]\n${knowledgeText.trim()}`);
            }

            if (graphText && graphText.trim()) {
                sections.push(`=== KNOWLEDGE GRAPH CONNECTIONS (GraphRAG) ===\n${graphText.trim()}`);
            }

            if (recentText.trim()) {
                sections.push(`[CONVERSATION RECENT HISTORY (LAST 20)]\n${recentText.trim()}`);
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
        await this.initialize().catch(() => {});
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
        await this.initialize().catch(() => {});
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
        await this.initialize().catch(() => {});
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
                } catch (e) {}

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

    private async saveVectorStore(): Promise<void> {
        if (!this.vectorStore) return;
        try {
            const vectors = this.vectorStore.memoryVectors.map(v => ({
                content: v.content,
                metadata: v.metadata,
                embedding: v.embedding
            }));
            await fs.writeFile(this.storagePath, JSON.stringify(vectors, null, 2));
        } catch (err: any) {
            console.error("[Memory] Failed to save semantic core:", err.message);
        }
    }
}

function docToText(doc: any): string {
    return doc ? doc.pageContent || JSON.stringify(doc) : "";
}

export const memory = MemoryManager.getInstance();
