const fs = require('fs');
const path = require('path');

const filePath = path.resolve('src/memory/manager.ts');
let raw = fs.readFileSync(filePath, 'utf8');
let code = raw.replace(/\r\n/g, '\n');

// 1. Table schema & migration for summaries
const oldSummariesSchema = `                this.db.run(\`
                    CREATE TABLE IF NOT EXISTS summaries (
                        id TEXT PRIMARY KEY,
                        from_interaction INTEGER,
                        to_interaction INTEGER,
                        summary_text TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                \`, (err) => { if (err) reject(err); });`;

const newSummariesSchema = `                this.db.run(\`
                    CREATE TABLE IF NOT EXISTS summaries (
                        id TEXT PRIMARY KEY,
                        chat_id TEXT DEFAULT 'default',
                        from_interaction INTEGER,
                        to_interaction INTEGER,
                        summary_text TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                \`, (err) => { if (err) reject(err); });

                this.db.all(\`PRAGMA table_info(summaries)\`, (err, cols) => {
                    if (!err && cols && Array.isArray(cols)) {
                        const colNames = cols.map(c => c.name);
                        if (!colNames.includes('chat_id')) {
                            this.db.run(\`ALTER TABLE summaries ADD COLUMN chat_id TEXT DEFAULT 'default'\`, () => { });
                        }
                    }
                });
                this.db.run(\`CREATE INDEX IF NOT EXISTS idx_summaries_chat ON summaries(chat_id)\`, () => { });`;

if (code.includes(oldSummariesSchema)) {
    code = code.replace(oldSummariesSchema, newSummariesSchema);
    console.log("Applied Change 1: summaries schema & migration");
} else if (code.includes("chat_id TEXT DEFAULT 'default'")) {
    console.log("Change 1 already applied.");
}

// 2. Fact update invalidation in saveStructuredFact
const oldVectorizeUpdate = `            // Vectorize updated fact
            if (this.vectorStore) {
                try {
                    const docText = \`Fact [\${fact.category}] \${fact.key.replace(/_/g, " ")}: \${fact.value}\`;
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
            }`;

const newVectorizeUpdate = `            // Vectorize updated fact (with stale vector invalidation)
            if (this.vectorStore) {
                try {
                    // 1. Invalidate stale in-memory vectors matching this fact ID or (chatId, key, category)
                    this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.filter((v: any) => {
                        const m = v.metadata || {};
                        const matchesId = m.id === existing.id;
                        const matchesKeyAndChat = (m.chatId === chatId || m.chat_id === chatId) &&
                                                  m.key === existing.key &&
                                                  m.category === existing.category;
                        return !matchesId && !matchesKeyAndChat;
                    });

                    // 2. Invalidate in Turso database table if available
                    if (this.db && this.db.getDriverName() === "turso") {
                        await this.db.run(
                            \`DELETE FROM semantic_vectors WHERE id = ? OR (chat_id = ? AND json_extract(metadata, '$.key') = ?)\`,
                            [existing.id, chatId, existing.key]
                        ).catch(() => {});
                    }

                    // 3. Clear embedding cache to prevent serving stale cached context
                    this.embeddingCache.clear();

                    const docText = \`Fact [\${fact.category}] \${fact.key.replace(/_/g, " ")}: \${fact.value}\`;
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
            }`;

if (code.includes(oldVectorizeUpdate)) {
    code = code.replace(oldVectorizeUpdate, newVectorizeUpdate);
    console.log("Applied Change 2: Fact update vector invalidation");
}

// 3. checkAndSummarizeOldInteractions scoping
const oldSummarizeMethod = `    private async checkAndSummarizeOldInteractions(): Promise<void> {
        try {
            const count: number = await new Promise((resolve) => {
                this.db.get<{ total: number }>(\`SELECT COUNT(*) as total FROM interactions\`, [], (err, row) => {
                    resolve(row ? row.total : 0);
                });
            });

            if (count > 0 && count % 50 === 0) {
                console.log(\`[Memory] Auto-summarization triggered at \${count} interactions...\`);
                const rows = await new Promise<any[]>((resolve) => {
                    this.db.all(\`SELECT * FROM interactions ORDER BY timestamp ASC LIMIT 50\`, [], (err, r) => resolve(r || []));
                });

                if (rows.length >= 50) {
                    const transcript = rows.map(r => \`User: \${r.user_msg}\\nAgent: \${r.agent_res}\`).join("\\n\\n");
                    const prompt = \`Summarize the key decisions, user facts, and topics discussed in this conversation transcript concise bullet points:\\n\\n\${transcript}\`;

                    const router = ModelRouter.getInstance();
                    const summaryRes = await router.invoke([
                        new SystemMessage("You are an expert conversation summarizer."),
                        new HumanMessage(prompt)
                    ], "summarizer");

                    const summaryText = summaryRes.content as string;
                    const sumId = \`sum_\${Date.now()}\`;

                    await new Promise<void>((resolve) => {
                        this.db.run(
                            \`INSERT INTO summaries (id, from_interaction, to_interaction, summary_text) VALUES (?, ?, ?, ?)\`,
                            [sumId, 1, 50, summaryText],
                            () => resolve()
                        );
                    });
                    console.log(\`[Memory] Auto-summarization complete.\`);
                }
            }
        } catch (e: any) {
            console.warn("[Memory] Summarization skipped:", e.message);
        }
    }`;

const newSummarizeMethod = `    private async checkAndSummarizeOldInteractions(chatId: string = "default"): Promise<void> {
        try {
            const count: number = await new Promise((resolve) => {
                this.db.get<{ total: number }>(\`SELECT COUNT(*) as total FROM interactions WHERE chat_id = ?\`, [chatId], (err, row) => {
                    resolve(row ? row.total : 0);
                });
            });

            if (count > 0 && count % 50 === 0) {
                console.log(\`[Memory] Auto-summarization triggered for chat \${chatId} at \${count} interactions...\`);
                const rows = await new Promise<any[]>((resolve) => {
                    this.db.all(\`SELECT * FROM interactions WHERE chat_id = ? ORDER BY timestamp ASC LIMIT 50\`, [chatId], (err, r) => resolve(r || []));
                });

                if (rows.length >= 50) {
                    const transcript = rows.map(r => \`User: \${r.user_msg}\\nAgent: \${r.agent_res}\`).join("\\n\\n");
                    const prompt = \`Summarize the key decisions, user facts, and topics discussed in this conversation transcript concise bullet points:\\n\\n\${transcript}\`;

                    const router = ModelRouter.getInstance();
                    const summaryRes = await router.invoke([
                        new SystemMessage("You are an expert conversation summarizer."),
                        new HumanMessage(prompt)
                    ], "summarizer");

                    const summaryText = summaryRes.content as string;
                    const sumId = \`sum_\${Date.now()}\`;

                    await new Promise<void>((resolve) => {
                        this.db.run(
                            \`INSERT INTO summaries (id, chat_id, from_interaction, to_interaction, summary_text) VALUES (?, ?, ?, ?, ?)\`,
                            [sumId, chatId, 1, 50, summaryText],
                            () => resolve()
                        );
                    });
                    console.log(\`[Memory] Auto-summarization complete for chat \${chatId}.\`);
                }
            }
        } catch (e: any) {
            console.warn("[Memory] Summarization skipped:", e.message);
        }
    }`;

if (code.includes(oldSummarizeMethod)) {
    code = code.replace(oldSummarizeMethod, newSummarizeMethod);
    console.log("Applied Change 3: checkAndSummarizeOldInteractions tenant scoping");
}

// 4. getRelevantSummaries tenant scoping
const oldGetSummaries = `    public async getRelevantSummaries(): Promise<any[]> {
        return new Promise<any[]>((resolve) => {
            this.db.all(\`SELECT summary_text FROM summaries ORDER BY timestamp DESC LIMIT 3\`, [], (err, rows) => {
                if (err || !rows) resolve([]);
                else resolve(rows);
            });
        });
    }`;

const newGetSummaries = `    public async getRelevantSummaries(chatId: string = "default"): Promise<any[]> {
        return new Promise<any[]>((resolve) => {
            this.db.all(
                \`SELECT summary_text FROM summaries WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 3\`,
                [chatId],
                (err, rows) => {
                    if (err || !rows) resolve([]);
                    else resolve(rows);
                }
            );
        });
    }`;

if (code.includes(oldGetSummaries)) {
    code = code.replace(oldGetSummaries, newGetSummaries);
    console.log("Applied Change 4: getRelevantSummaries tenant scoping");
}

// 5. getSemanticContext strict tenant isolation
const oldGetSemanticContext = `    public async getSemanticContext(userInput: string, chatId?: string): Promise<string> {
        if (!this.vectorStore || !userInput) return "";
        try {
            const cacheKey = userInput.substring(0, 100);
            if (this.embeddingCache.has(cacheKey)) {
                const results = await this.vectorStore.similaritySearch(userInput, 15);
                const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
                return ranked.slice(0, 8).map(r => r.text).join("\\n---\\n");
            }

            if (this.embeddingCache.size > 50) {
                const keysToDelete = Array.from(this.embeddingCache.keys()).slice(0, 10);
                keysToDelete.forEach(k => this.embeddingCache.delete(k));
            }

            const results = await this.vectorStore.similaritySearch(userInput, 15);
            this.embeddingCache.set(cacheKey, [1]);
            const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
            return ranked.slice(0, 8).map(r => r.text).join("\\n---\\n");
        } catch (e: any) {
            console.log('[Memory] Vector search unavailable — using SQLite only.');
            return "";
        }
    }`;

const newGetSemanticContext = `    public async getSemanticContext(userInput: string, chatId?: string): Promise<string> {
        if (!this.vectorStore || !userInput) return "";
        const targetChatId = String(chatId || "").trim();
        if (!targetChatId) {
            // Fail closed: never return un-isolated vectors to an anonymous or unspecified tenant
            return "";
        }

        try {
            const cacheKey = \`\${targetChatId}::\${userInput.substring(0, 100)}\`;
            const filterFn = (doc: any) => {
                const docChat = String(doc.metadata?.chatId || doc.metadata?.chat_id || "").trim();
                return docChat === targetChatId;
            };

            if (this.embeddingCache.has(cacheKey)) {
                const results = await this.vectorStore.similaritySearch(userInput, 15, filterFn);
                const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
                return ranked.slice(0, 8).map(r => r.text).join("\\n---\\n");
            }

            if (this.embeddingCache.size > 50) {
                const keysToDelete = Array.from(this.embeddingCache.keys()).slice(0, 10);
                keysToDelete.forEach(k => this.embeddingCache.delete(k));
            }

            const results = await this.vectorStore.similaritySearch(userInput, 15, filterFn);
            this.embeddingCache.set(cacheKey, [1]);
            const ranked = this.rankContentByRelevance(userInput, results.map(r => ({ text: r.pageContent })));
            return ranked.slice(0, 8).map(r => r.text).join("\\n---\\n");
        } catch (e: any) {
            console.log('[Memory] Vector search unavailable — using SQLite only.');
            return "";
        }
    }`;

if (code.includes(oldGetSemanticContext)) {
    code = code.replace(oldGetSemanticContext, newGetSemanticContext);
    console.log("Applied Change 5: getSemanticContext strict tenant isolation");
}

// 6. searchMemory tenant filter
const oldSearchMemoryVec = `                const vecDocs = await Promise.race([
                    this.vectorStore.similaritySearch(query, 6),
                    timeoutPromise
                ]).finally(() => clearTimeout(timer!));

                const userVecDocs = vecDocs ? vecDocs.filter(d => {
                    if (d.metadata?.isDoc) return true;
                    if (chatId === "default") return !d.metadata?.chatId || d.metadata.chatId === "default";
                    return d.metadata?.chatId === chatId;
                }) : [];`;

const newSearchMemoryVec = `                const targetChatId = String(chatId || "default").trim();
                const filterFn = (d: any) => {
                    const dChat = String(d.metadata?.chatId || d.metadata?.chat_id || "").trim();
                    if (d.metadata?.isDoc) return true;
                    return dChat === targetChatId;
                };
                const vecDocs = await Promise.race([
                    this.vectorStore.similaritySearch(query, 6, filterFn),
                    timeoutPromise
                ]).finally(() => clearTimeout(timer!));

                const userVecDocs = vecDocs || [];`;

if (code.includes(oldSearchMemoryVec)) {
    code = code.replace(oldSearchMemoryVec, newSearchMemoryVec);
    console.log("Applied Change 6: searchMemory tenant filter");
}

// 7. getRecentTurns normalization
const oldGetRecentTurns = `        public async getRecentTurns(chatId: string = "default", limit: number = 10): Promise<{ user_msg: string; agent_res: string }[]> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            this.db.all(
                \`SELECT user_msg, agent_res FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC, id DESC, rowid DESC LIMIT ?\`,
                [chatId, limit],
                (err, rows: any[]) => {
                    if (err || !rows) resolve([]);
                    else resolve(rows.reverse());
                }
            );
        });
    }`;

const newGetRecentTurns = `    public async getRecentTurns(chatId: string = "default", limit: number = 10): Promise<{ user_msg: string; agent_res: string; user_message: string; agent_response: string }[]> {
        await this.initialize().catch(() => {});
        return new Promise((resolve) => {
            this.db.all(
                \`SELECT user_msg, agent_res FROM interactions WHERE chat_id = ? ORDER BY timestamp DESC, id DESC, rowid DESC LIMIT ?\`,
                [chatId, limit],
                (err, rows: any[]) => {
                    if (err || !rows) resolve([]);
                    else {
                        const normalized = rows.map(r => ({
                            user_msg: r.user_msg,
                            agent_res: r.agent_res,
                            user_message: r.user_msg,
                            agent_response: r.agent_res
                        }));
                        resolve(normalized.reverse());
                    }
                }
            );
        });
    }`;

if (code.includes(oldGetRecentTurns)) {
    code = code.replace(oldGetRecentTurns, newGetRecentTurns);
    console.log("Applied Change 7: getRecentTurns normalization");
}

// 8. getContext layer calls
const oldGetContextLayers = `            const [l1, l2, l3, l4, lKg] = await Promise.all([
                this.executeLayerWithTimeout("Layer 1 (Recent History)", () => this.getRecentHistory(chatId), []),
                this.executeLayerWithTimeout("Layer 2 (Vector Search)", () => this.getSemanticContext(userInput), ""),
                this.executeLayerWithTimeout("Layer 3 (Knowledge Facts)", () => this.getAllFacts(chatId), []),
                this.executeLayerWithTimeout("Layer 4 (Summaries)", () => this.getRelevantSummaries(), []),
                this.executeLayerWithTimeout("GraphRAG", () => kg.traverseSubGraph(seedKeywords, 2), { seedEntities: [], visitedEntities: [], triples: [] })
            ]);`;

const newGetContextLayers = `            const [l1, l2, l3, l4, lKg] = await Promise.all([
                this.executeLayerWithTimeout("Layer 1 (Recent History)", () => this.getRecentHistory(chatId), []),
                this.executeLayerWithTimeout("Layer 2 (Vector Search)", () => this.getSemanticContext(userInput, chatId), ""),
                this.executeLayerWithTimeout("Layer 3 (Knowledge Facts)", () => this.getAllFacts(chatId), []),
                this.executeLayerWithTimeout("Layer 4 (Summaries)", () => this.getRelevantSummaries(chatId), []),
                this.executeLayerWithTimeout("GraphRAG", () => kg.traverseSubGraph(seedKeywords, 2), { seedEntities: [], visitedEntities: [], triples: [] })
            ]);`;

if (code.includes(oldGetContextLayers)) {
    code = code.replace(oldGetContextLayers, newGetContextLayers);
    console.log("Applied Change 8: getContext layer calls passing chatId");
}

// 9. addInteraction passing chatId to checkAndSummarizeOldInteractions
const oldAddInteractionSummarize = `                        await this.extractFactsFromText(userInput, chatId);
                        await this.checkAndSummarizeOldInteractions();`;

const newAddInteractionSummarize = `                        await this.extractFactsFromText(userInput, chatId);
                        await this.checkAndSummarizeOldInteractions(chatId);`;

if (code.includes(oldAddInteractionSummarize)) {
    code = code.replace(oldAddInteractionSummarize, newAddInteractionSummarize);
    console.log("Applied Change 9: addInteraction passing chatId to summarize");
}

fs.writeFileSync(filePath, code, 'utf8');
console.log("Successfully updated src/memory/manager.ts with all changes");
