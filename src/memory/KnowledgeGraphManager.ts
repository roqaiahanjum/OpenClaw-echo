// @ts-nocheck
import sqlite3 from "sqlite3";
import * as dotenv from "dotenv";

dotenv.config();

export interface GraphEntity {
    id: string;
    name: string;
    type: string;
    description?: string;
    created_at: string;
}

export interface GraphTriple {
    id: string;
    subject_id: string;
    subject_name: string;
    predicate: string;
    object_id: string;
    object_name: string;
    confidence: number;
    created_at: string;
}

export interface SubGraphTraversal {
    seedEntities: string[];
    visitedEntities: GraphEntity[];
    triples: GraphTriple[];
}

export class KnowledgeGraphManager {
    private static instance: KnowledgeGraphManager;
    private db: sqlite3.Database;
    private isInitialized: boolean = false;

    private constructor() {
        this.db = new sqlite3.Database("./openclaw.db", (err) => {
            if (err) {
                console.error("[Graph] SQLite Connection Error:", err.message);
            } else {
                console.log("[Graph] SQLite Connected to Graph Storage.");
            }
        });
    }

    public static getInstance(): KnowledgeGraphManager {
        if (!KnowledgeGraphManager.instance) {
            KnowledgeGraphManager.instance = new KnowledgeGraphManager();
        }
        return KnowledgeGraphManager.instance;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        await this.initializeTables();
        this.isInitialized = true;
    }

    private normalizeSlug(text: string): string {
        return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "entity";
    }

    private async initializeTables(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS graph_entities (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        type TEXT DEFAULT 'CONCEPT',
                        description TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS graph_triples (
                        id TEXT PRIMARY KEY,
                        subject_id TEXT NOT NULL,
                        subject_name TEXT NOT NULL,
                        predicate TEXT NOT NULL,
                        object_id TEXT NOT NULL,
                        object_name TEXT NOT NULL,
                        confidence REAL DEFAULT 1.0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(subject_id, predicate, object_id)
                    )
                `);

                this.db.run(`CREATE INDEX IF NOT EXISTS idx_triple_sub ON graph_triples(subject_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_triple_obj ON graph_triples(object_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_triple_pred ON graph_triples(predicate)`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    public async upsertEntity(name: string, type: string = "CONCEPT", description: string = ""): Promise<GraphEntity> {
        await this.initialize().catch(() => {});
        const id = this.normalizeSlug(name);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO graph_entities (id, name, type, description, created_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(id) DO UPDATE SET
                   type = excluded.type,
                   description = CASE WHEN excluded.description != '' THEN excluded.description ELSE graph_entities.description END`,
                [id, name.trim(), type.toUpperCase(), description],
                (err) => {
                    if (err) {
                        console.error("[Graph] Upsert Entity Error:", err.message);
                        reject(err);
                    } else {
                        resolve({
                            id,
                            name: name.trim(),
                            type: type.toUpperCase(),
                            description,
                            created_at: new Date().toISOString()
                        });
                    }
                }
            );
        });
    }

    public async addTriple(
        subjectName: string,
        predicate: string,
        objectName: string,
        options?: { subjectType?: string; objectType?: string; confidence?: number }
    ): Promise<boolean> {
        await this.initialize().catch(() => {});

        const subEntity = await this.upsertEntity(subjectName, options?.subjectType || "CONCEPT");
        const objEntity = await this.upsertEntity(objectName, options?.objectType || "CONCEPT");
        const normPred = predicate.trim().toUpperCase().replace(/\s+/g, "_");
        const tripleId = `rel_${subEntity.id}_${normPred}_${objEntity.id}`;
        const confidence = options?.confidence || 1.0;

        return new Promise((resolve) => {
            this.db.run(
                `INSERT INTO graph_triples (id, subject_id, subject_name, predicate, object_id, object_name, confidence, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(subject_id, predicate, object_id) DO UPDATE SET
                   confidence = excluded.confidence,
                   created_at = CURRENT_TIMESTAMP`,
                [tripleId, subEntity.id, subEntity.name, normPred, objEntity.id, objEntity.name, confidence],
                (err) => {
                    if (err) {
                        console.error("[Graph] Add Triple Error:", err.message);
                        resolve(false);
                    } else {
                        console.log(`[Graph] Triple Stored -> (${subEntity.name}) -[${normPred}]-> (${objEntity.name})`);
                        resolve(true);
                    }
                }
            );
        });
    }

    public async traverseSubGraph(seedNames: string[], maxDepth: number = 2): Promise<SubGraphTraversal> {
        await this.initialize().catch(() => {});

        const seedSlugs = seedNames.map(n => this.normalizeSlug(n));
        const visitedEntityIds = new Set<string>(seedSlugs);
        const visitedTripleIds = new Set<string>();
        const resultTriples: GraphTriple[] = [];
        const resultEntities: GraphEntity[] = [];

        let currentQueue = [...seedSlugs];

        for (let depth = 0; depth < maxDepth; depth++) {
            if (currentQueue.length === 0) break;
            const nextQueue: string[] = [];

            for (const entityId of currentQueue) {
                const triples: GraphTriple[] = await new Promise((resolve) => {
                    this.db.all<GraphTriple>(
                        `SELECT * FROM graph_triples WHERE subject_id = ? OR object_id = ?`,
                        [entityId, entityId],
                        (err, rows) => resolve(rows || [])
                    );
                });

                for (const t of triples) {
                    if (!visitedTripleIds.has(t.id)) {
                        visitedTripleIds.add(t.id);
                        resultTriples.push(t);

                        const neighborId = t.subject_id === entityId ? t.object_id : t.subject_id;
                        if (!visitedEntityIds.has(neighborId)) {
                            visitedEntityIds.add(neighborId);
                            nextQueue.push(neighborId);
                        }
                    }
                }
            }

            currentQueue = nextQueue;
        }

        if (visitedEntityIds.size > 0) {
            const placeholders = Array.from(visitedEntityIds).map(() => "?").join(",");
            const entities: GraphEntity[] = await new Promise((resolve) => {
                this.db.all<GraphEntity>(
                    `SELECT * FROM graph_entities WHERE id IN (${placeholders})`,
                    Array.from(visitedEntityIds),
                    (err, rows) => resolve(rows || [])
                );
            });
            resultEntities.push(...entities);
        }

        return {
            seedEntities: seedNames,
            visitedEntities: resultEntities,
            triples: resultTriples
        };
    }

    public formatGraphContextForLLM(traversal: SubGraphTraversal): string {
        if (!traversal || traversal.triples.length === 0) return "";

        const tripleStrings = traversal.triples.map(
            t => `(${t.subject_name}) --[${t.predicate}]--> (${t.object_name})`
        );

        return `[KNOWLEDGE GRAPH RELATIONS (2-HOP GraphRAG)]\n` + tripleStrings.join("\n");
    }

    public async getGraphStats(): Promise<{ entities: number; triples: number }> {
        await this.initialize().catch(() => {});
        const entities: number = await new Promise(res => this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM graph_entities`, [], (e, r) => res(r ? r.c : 0)));
        const triples: number = await new Promise(res => this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM graph_triples`, [], (e, r) => res(r ? r.c : 0)));
        return { entities, triples };
    }
}

export const knowledgeGraph = KnowledgeGraphManager.getInstance();
