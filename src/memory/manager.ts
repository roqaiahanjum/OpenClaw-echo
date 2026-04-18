// @ts-nocheck
import sqlite3 from "sqlite3";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";

dotenv.config();

interface SerializedVector {
    content: string;
    metadata: any;
    embedding: number[];
}

interface InteractionRow {
    user_msg: string;
    agent_res: string;
}

export class MemoryManager {
    private db: sqlite3.Database;
    private vectorStore: MemoryVectorStore | null = null;
    private embeddings: GoogleGenerativeAIEmbeddings;
    private storagePath: string = path.join(__dirname, "semantic_core.json");

    constructor() {
        // 1. Initialize SQLite
        this.db = new sqlite3.Database("./openclaw.db", (err) => {
            if (err) {
                console.error("[Memory] SQLite Connection Error:", err.message);
            } else {
                console.log("[Memory] SQLite Connected.");
                this.initializeTable();
            }
        });

        // 2. Initialize Embeddings ✅ Fixed: env key + correct model, no apiVersion
        this.embeddings = new GoogleGenerativeAIEmbeddings({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-embedding-001",
        });

        // 3. Initialize Local Vector Store
        this.initVectorStore();
    }

    private async initVectorStore() {
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
            console.log("[Memory] Serverless Vector Core initialized.");
        } catch (error: any) {
            console.warn("[Memory] Vector Core initialization failed:", error.message);
        }
    }

    private initializeTable() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS interactions (
                id TEXT PRIMARY KEY,
                user_msg TEXT,
                agent_res TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    async addInteraction(userInput: string, response: string): Promise<void> {
        const id = `msg_${Date.now()}`;

        return new Promise((resolve, reject) => {
            this.db.run(
                "INSERT INTO interactions (id, user_msg, agent_res) VALUES (?, ?, ?)",
                [id, userInput, response],
                async (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (this.vectorStore) {
                            try {
                                await this.vectorStore.addDocuments([
                                    {
                                        pageContent: userInput,
                                        metadata: {
                                            response,
                                            id,
                                            timestamp: new Date().toISOString()
                                        }
                                    }
                                ]);
                                await this.saveVectorStore();
                            } catch (vErr: any) {
                                console.error("[Memory] Semantic Storage Error:", vErr.message);
                            }
                        }
                        resolve();
                    }
                }
            );
        });
    }

    private async saveVectorStore() {
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

    async ingestDocument(content: string, source: string): Promise<void> {
        if (!this.vectorStore) return;
        try {
            console.log(`[Memory] Ingesting knowledge from: ${source}`);
            const id = `doc_${Date.now()}`;
            await this.vectorStore.addDocuments([
                {
                    pageContent: content,
                    metadata: {
                        source,
                        id,
                        isKnowledge: true,
                        timestamp: new Date().toISOString()
                    }
                }
            ]);
            await this.saveVectorStore();
        } catch (error: any) {
            console.error("[Memory] Ingestion Error:", error.message);
        }
    }

    async getContext(userInput: string): Promise<string> {
        let semanticContext = "";
        let knowledgeContext = "";

        if (this.vectorStore) {
            try {
                const results = await this.vectorStore.similaritySearch(userInput, 4);
                const chatHistory = results.filter(d => !d.metadata.isKnowledge);
                const knowledgeBase = results.filter(d => d.metadata.isKnowledge);

                if (chatHistory.length > 0) {
                    semanticContext = chatHistory
                        .map(doc => `Related History: ${doc.pageContent}\nPast Response: ${doc.metadata.response}`)
                        .join("\n\n");
                }

                if (knowledgeBase.length > 0) {
                    knowledgeContext = knowledgeBase
                        .map(doc => `[From Knowledge: ${doc.metadata.source}]\n${doc.pageContent}`)
                        .join("\n\n");
                }
            } catch (error: any) {
                console.error("[Memory] Semantic Search Error:", error.message);
            }
        }

        const recentHistory: string = await new Promise((resolve) => {
            this.db.all<InteractionRow>(
                "SELECT user_msg, agent_res FROM interactions ORDER BY timestamp DESC LIMIT 2",
                [],
                (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        resolve("");
                        return;
                    }
                    const items = rows
                        .reverse()
                        .map((row) => `User: ${row.user_msg}\nAgent: ${row.agent_res}`)
                        .join("\n\n");
                    resolve(items);
                }
            );
        });

        let finalContext = "Current Context (History):\n";
        if (knowledgeContext) finalContext += `--- SPECIALIZED KNOWLEDGE ---\n${knowledgeContext}\n\n`;
        if (semanticContext) finalContext += `--- Semantically Related ---\n${semanticContext}\n\n`;
        if (recentHistory) finalContext += `--- Recent Interactions ---\n${recentHistory}`;

        return finalContext;
    }

    async checkHealth() {
        const health = {
            sqlite: { status: "connected", details: "Local Database Ready." },
            chroma: { status: "connected", details: "Serverless Local Core Live." }
        };
        if (!this.vectorStore) {
            health.chroma.status = "disconnected";
            health.chroma.details = "Initialization error.";
        }
        return health;
    }

    async close() {
        return new Promise<void>((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    console.error("[Memory] Error closing SQLite:", err.message);
                    reject(err);
                } else {
                    console.log("[Memory] SQLite connection closed.");
                    resolve();
                }
            });
        });
    }
}