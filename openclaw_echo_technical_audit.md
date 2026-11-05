# OpenClaw Echo: Complete Technical Documentation Audit & Final Year Project Report Blueprint

> **Verification Legend**:
> - `[VERIFIED]`: Implemented and confirmed directly from the active project codebase.
> - `[PARTIALLY IMPLEMENTED]`: Present in codebase but incomplete or operating with limitations/fallbacks.
> - `[NOT VERIFIED IN CODE]`: Referenced in legacy documentation/specifications but not found in current active codebase.

---

## PART 1 — COMPLETE PROJECT OVERVIEW

### 1. Project Title
**OpenClaw Echo – A Self-Evolving Autonomous AI Agent Framework with Hybrid Intelligence, Swarm Sub-Agents, and Persistent Memory** `[VERIFIED]`

### 2. Problem Being Solved
Standard LLM wrappers and chat interfaces suffer from key single-point-of-failure issues:
1. **API Fragility & Downtime**: Dependency on a single model provider causes total outage during rate-limits, API degradation, or server failures.
2. **Stateless Session Disconnect**: Standard AI models lack persistent cross-session memory, forgetting user preferences, historical interactions, and structural knowledge over time.
3. **Static Skill Sets**: Traditional agents cannot create new tools dynamically at runtime when faced with novel tasks.
4. **Lack of Self-Correction & Verification**: Standard agents output hallucinations without step-level output verification, sandbox isolation, or automated recovery.
5. **Monolithic Task Bottlenecks**: Complex multi-step reasoning overburdens single prompts rather than distributing tasks to specialized autonomous worker agents.

### 3. Motivation
To build a **local-first, production-grade autonomous agent system** capable of running continuous 24/7 operations over Telegram and Web interfaces. OpenClaw Echo combines multi-provider failover routing, multi-tier memory (relational, vector, graph), local sandbox code execution, dynamic skill synthesis, and multi-agent sub-swarms into an open, extensible framework.

### 4. Main Objective
To design, implement, and audit a self-evolving autonomous AI framework that delivers **uninterrupted operational availability**, **multi-layered memory persistence**, **runtime code sandboxing**, and **self-healing execution loops**.

### 5. Secondary Objectives
- **Zero-Downtime Multi-Model Waterfall Routing**: Seamless switching between Google Gemini and Groq LLMs with rate-limit tracking and circuit breakers `[VERIFIED]`.
- **4-Layer Persistent Memory Architecture**: Integration of SQLite relational store, RAG vector embeddings, key-value fact tables, and Knowledge Graph entity-relation triples `[VERIFIED]`.
- **Deterministic & Neural Verification**: Dual-layer verification combining regex/pattern checking with LLM-based step output validation `[VERIFIED]`.
- **Safe Dynamic Skill Synthesis**: Runtime synthesis and hot-reloading of new JavaScript tools into `src/sandbox/skills/` with pre-compilation syntax validation `[VERIFIED]`.
- **Swarm Sub-Agent Delegation**: Task delegation to specialized worker roles (Researcher, Coder, Analyst, Writer, QA Engineer) operating in isolated scratchpads `[VERIFIED]`.
- **Cross-Platform Management**: Accessible via Telegram bot UI, React/Vite dashboard, and Streamlit admin panel `[VERIFIED]`.

### 6. Scope
- **Core Backend**: Built on Node.js, TypeScript, Express, and LangChain.
- **Messaging & UI**: Telegraf (Telegram Bot API), React 19 + Vite dashboard, and Streamlit Python monitoring panel.
- **Execution & Storage**: Local Node.js child-process sandbox, SQLite 3 database (`openclaw.db`), `@langchain/classic` MemoryVectorStore with JSON disk serialization (`semantic_core.json`), and Nodemailer for SMTP email reports.

### 7. Target Users
- **Software Engineers & System Administrators**: Needing automated environment audits, script generation/execution, git operations, and continuous task execution.
- **Researchers & Analysts**: Requiring automated multi-source web searches, document ingestion, and graph-based knowledge extraction.
- **Power Users & Remote Operators**: Managing autonomous tasks via Telegram with rich formatting, Chart.js visualizations, and automated notifications.

### 8. What Makes OpenClaw Echo Different from ChatGPT / Claude
| Feature | ChatGPT / Claude | OpenClaw Echo | Status |
| :--- | :--- | :--- | :--- |
| **System Architecture** | Closed SaaS web application / Single API endpoint | Open-source, local-first multi-provider backend | `[VERIFIED]` |
| **Resilience & Failover** | Fails on single-provider API outage | Zero-downtime multi-provider waterfall routing (Gemini + Groq) | `[VERIFIED]` |
| **Memory Persistence** | Thread-bound or simple user custom instructions | 4-Layer Memory (Relational, Vector RAG, Fact Store, Knowledge Graph) | `[VERIFIED]` |
| **Tool Extensibility** | Fixed toolset (Web, Interpreter) | Dynamic runtime skill synthesis & hot-reloading in JS sandbox | `[VERIFIED]` |
| **Sub-Agent Delegation** | Monolithic single-thread execution | Specialized Swarm Workers (Coder, Researcher, Analyst, etc.) | `[VERIFIED]` |
| **Self-Healing Loop** | Relies on user to manually prompt corrections | Automatic dual-layer verifier & self-recovery strategy selector | `[VERIFIED]` |
| **Deployment Interfaces** | Proprietary Web/App UI | Telegram Bot + React Dashboard + Streamlit Admin Panel | `[VERIFIED]` |

### 9. Overall Workflow

#### Simple Explanation:
1. User sends a message via Telegram.
2. OpenClaw Echo checks if it's a simple greeting or complex task.
3. If complex, it pulls past facts and knowledge graph data from its multi-layer memory.
4. The Planner breaks the task down into smaller steps.
5. The Model Router selects the best available AI provider (Gemini or Groq) with failover protection.
6. The AI picks and executes appropriate tools in a safe local sandbox.
7. The Verifier checks if the tool output is correct. If it failed, the Recovery system self-heals and retries.
8. New knowledge is saved back to memory and graph database.
9. Final response (with optional visual charts/reports) is delivered back to Telegram.

#### Technical Workflow:
```
User Prompt (Telegram)
  │
  ▼
Telegraf Middleware (src/integrations/telegram.ts)
  │
  ▼
Conversation Guard (src/core/conversationGuard.ts) ──[Simple Prompt?]──► Direct LLM Stream Response
  │ (Complex / Multi-step)
  ▼
Memory Retrieval (src/memory/manager.ts)
  ├── SQLite Interactions History
  ├── MemoryVectorStore RAG (semantic_core.json)
  ├── Layer 3 Knowledge Facts
  └── Knowledge Graph Triples (kg_triples)
  │
  ▼
Execution Planner (src/core/planner.ts)
  │
  ▼
Model Router Waterfall (src/core/router.ts)
  ├── 1. Check Rate Limits (Groq RPM Tracker) & Cooldowns (Circuit Breaker)
  ├── 2. Attempt Provider 1 (e.g. Groq / Gemini)
  └── 3. Failover to Provider 2 (Gemini / Groq 70B)
  │
  ▼
LLM Tool Selection & Execution Loop
  ├── Sandbox Execution (src/sandbox/)
  ├── Web API Calls (Tavily, SMTP, Git)
  └── Sub-Agent Delegation (src/agents/workers/)
  │
  ▼
Verification & Recovery Loop
  ├── Dual Verifier (localVerifier.ts + verifier.ts)
  └── Recovery Strategy Engine (src/core/recovery.ts)
  │
  ▼
Memory Persistence
  ├── Ingest Interaction to SQLite
  ├── Vector Embedding Indexing (text-embedding-004)
  └── Knowledge Graph Triple Extraction (graphExtractor.ts)
  │
  ▼
Telegram Safe Message Delivery (Formatting & Splitting)
```

### 10. Main Capabilities
1. **Zero-Downtime Model Waterfall**: Automatic multi-provider failover between Gemini 2.5 Flash and Groq Llama models.
2. **4-Tier Persistent Memory System**: SQLite history, Vector RAG embeddings, structured key-value fact store, and entity-relation Knowledge Graph triples.
3. **Dynamic Runtime Skill Synthesis**: Generating, syntax-validating, and hot-registering new JavaScript tools dynamically at runtime without restarting the process.
4. **Local Execution Sandbox**: Safe execution of generated `.js` scripts and data parsing inside isolated `src/sandbox/` paths.
5. **Interactive Chart Generation**: Creating standalone HTML visual charts using Chart.js.
6. **Swarm Sub-Agent Delegation**: Dispatching sub-tasks to specialized sub-agents operating with isolated scratchpad memories.
7. **Dual Verification & Self-Healing**: Deterministic pattern verification combined with LLM step verification and automatic recovery strategy recommendations.
8. **SMTP Email Reporting**: Sending automated HTML executive reports via Nodemailer.

---

## PART 2 — COMPLETE TECHNOLOGY STACK

### Technology Stack Table

| Technology | Version | Where Used | Purpose | Verified? |
| :--- | :--- | :--- | :--- | :--- |
| **Node.js** | `>=20.0.0` | Server Runtime (`src/index.ts`) | Core JavaScript/TypeScript execution environment | `[VERIFIED]` |
| **TypeScript** | `^5.6.3` | System-wide (`src/`) | Static type checking and compilation | `[VERIFIED]` |
| **Express** | `^4.21.1` | Web Server (`src/integrations/telegram.ts`) | REST API and static dashboard web serving | `[VERIFIED]` |
| **Telegraf** | `^4.16.3` | Telegram Bot (`src/integrations/telegram.ts`) | Telegram Bot API framework for user interactions | `[VERIFIED]` |
| **React** | `^19.2.4` | Web Dashboard (`dashboard/src/App.tsx`) | Frontend UI framework for system monitoring | `[VERIFIED]` |
| **Vite** | `^8.0.4` | Dashboard Build (`dashboard/vite.config.ts`) | Fast build tool and dev server for React dashboard | `[VERIFIED]` |
| **SQLite3** | `^6.0.1` | Relational Storage (`openclaw.db`) | Interactions history, key-value facts, and graph triples | `[VERIFIED]` |
| **LangChain Core / Classic**| `^1.1.40` / `^1.0.31` | Agent Architecture (`src/core/`, `src/skills/`) | Tool abstraction, message schemas, and vector store base | `[VERIFIED]` |
| **Google Generative AI** | `^2.1.28` (`@langchain/google-genai`) | Model Router & Memory Embeddings | Primary LLM (`gemini-2.5-flash`) & embeddings (`text-embedding-004`) | `[VERIFIED]` |
| **Groq SDK** | `^1.5.0` (`groq-sdk`) | Model Router (`src/core/router.ts`) | High-speed LLM fallback provider (`llama-3.3-70b`, `llama3-8b-8192`) | `[VERIFIED]` |
| **Zod** | `^3.23.8` | Tool Schema Definition (`src/skills/tools.ts`) | Input validation and JSON schema conversion for LLMs | `[VERIFIED]` |
| **Nodemailer** | `^8.0.5` | Diplomat Engine (`src/core/diplomat.ts`) | Sending automated email reports over SMTP | `[VERIFIED]` |
| **Tavily Search API** | REST (`https://api.tavily.com`) | Web Search Tool (`src/skills/tools.ts`) | Live web searching, real-time facts, and document fetching | `[VERIFIED]` |
| **Axios** | `^1.15.0` | Scraper & Utilities (`src/core/scraper.ts`) | HTTP client for web scraping and external API requests | `[VERIFIED]` |
| **Cheerio** | `^1.2.0` | Scraper (`src/core/scraper.ts`) | Server-side HTML parsing for website text extraction | `[VERIFIED]` |
| **Docker & Docker Compose** | Dockerfile (`node:20-alpine`) | Root deployment files | Containerized container deployment configuration | `[VERIFIED]` |
| **PM2** | Configured (`ecosystem.config.js`) | Deployment process runner | Background process management and autostart | `[VERIFIED]` |
| **Streamlit** | Python 3 (`admin_panel.py`) | Admin Panel (`admin_panel.py`) | Python dashboard for log inspection, SQLite browsing, and telemetry | `[VERIFIED]` |
| **Chart.js** | CDN runtime `3.x` | Sandbox (`generateDataChartTool`) | Visual HTML chart creation in sandbox | `[VERIFIED]` |
| **Mermaid.js** | `^11.14.0` | Visualizer & Dashboard (`visualizeArchitectureTool`) | System architecture diagram rendering | `[VERIFIED]` |
| **simple-git** | `^3.36.0` | Git Tool (`manageGitRepositoryTool`) | Git repository control and automated commits | `[VERIFIED]` |
| **dotenv** | `^16.4.5` | Environment loader (`src/index.ts`) | Loading API keys and environment variables | `[VERIFIED]` |
| **nodemon** | `^3.1.7` | Development tooling (`package.json`) | Hot-reloading server during local development | `[VERIFIED]` |
| **ChromaDB** | `^3.4.3` (`chromadb`) | `package.json` dependency | Vector database library listed in package dependencies | `[PARTIALLY IMPLEMENTED]` |
| **node-telegram-bot-api** | `^0.67.0` | `package.json` dependency | Alternative Telegram library present in package dependencies | `[CONFIGURED BUT UNUSED]` |
| **docx** | `^9.6.1` | `package.json` dependency | Word document generator present in package dependencies | `[CONFIGURED BUT UNUSED]` |
| **@langchain/ollama** | `^0.1.6` | `package.json` dependency | Ollama LangChain bridge present in package dependencies | `[EXPERIMENTAL / OFFLINE]` |

### Technology Categorization Breakdown

#### A. Actively Used
- **Runtime & Languages**: Node.js 20+, TypeScript 5.6, Python 3 (Admin panel).
- **Core Server & Routing**: Express 4, Telegraf 4, ModelRouter (`@langchain/google-genai`, `groq-sdk`).
- **Memory & Storage**: SQLite3 (`openclaw.db`), `@langchain/classic` MemoryVectorStore (`semantic_core.json`), `GoogleGenerativeAIEmbeddings` (`text-embedding-004`).
- **Tools & APIs**: Tavily Search API, Nodemailer, Cheerio, Axios, simple-git, Zod, Chart.js (CDN), Mermaid.js.
- **Frontend & Admin**: React 19, Vite 8, Streamlit 1.x.
- **Deployment**: Docker, Docker Compose, PM2, Windows Batch/VBS scripts.

#### B. Configured but Unused
- **ChromaDB (`chromadb`, `@chroma-core/default-embed`)**: Listed in `package.json`. In actual code (`src/memory/manager.ts`), vector memory uses `@langchain/classic` `MemoryVectorStore` with JSON disk persistence (`semantic_core.json`). ChromaDB is configured but replaced by memory vector store. `[PARTIALLY IMPLEMENTED]`
- **node-telegram-bot-api (`node-telegram-bot-api`)**: Listed in `package.json`. Bot implementation strictly uses `telegraf` (`src/integrations/telegram.ts`). `[CONFIGURED BUT UNUSED]`
- **docx (`docx`)**: Listed in `package.json`. Document generation in tools uses plain text/HTML sandbox files. `[CONFIGURED BUT UNUSED]`

#### C. Experimental / Offline
- **Ollama Provider (`@langchain/ollama`)**: Present in `package.json`. Checked in `router.ts` health check (`checkHealth()`), which explicitly reports `ollama: { status: "offline", details: "Ollama not running." }`. Not active in the production waterfall sequence. `[EXPERIMENTAL / OFFLINE]`
- **Sandbox Python / Txt Scratch Files**: (`sort_list.py`, `factorial.js`, `matrix.js`) located in `src/sandbox/`. Used for local testing scripts. `[EXPERIMENTAL / OFFLINE]`

#### D. Deprecated
- **Legacy Gemini Models (`gemini-1.5-flash`, `gemini-pro`)**: Superseded in code by `gemini-2.5-flash`. `[DEPRECATED]`
- **Legacy Groq Model Default (`llama3-8b-8192`)**: Used only as fallback default string in `WATERFALL_PROVIDERS` if `process.env.GROQ_MODEL` is absent. `[DEPRECATED]`

---

## PART 3 — COMPLETE ARCHITECTURE

### Detailed Component Architecture & Responsibility Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE LAYER                               │
│  Telegram Client (Mobile/Desktop)  │  React 19 Dashboard  │  Streamlit Admin │
└─────────────────┬──────────────────┴──────────┬───────────┴────────┬────────┘
                  │                             │                    │
                  ▼                             ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INTEGRATION & BOT LAYER                               │
│  src/integrations/telegram.ts ── Express REST Server (Port 3005)           │
│  ├── Telegraf Message Handlers & Safe Markdown Chunking                     │
│  └── Telemetry & System Status Endpoint (/api/status)                        │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GUARD & ROUTING LAYER                                 │
│  src/core/conversationGuard.ts ── Fast Deterministic Classifier             │
│  src/core/router.ts ───────────── Resilient Model Router & Waterfall Engine │
│  ├── Groq Rate Limiter (25 RPM Cap)                                         │
│  └── Model Circuit Breaker (5-Min Cooldown on 404/429)                      │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REASONING & PLANNING LAYER                            │
│  src/core/planner.ts ─────────── Deterministic & LLM Step Planning          │
│  src/core/analyzer.ts ────────── Project Structure & Architecture Analyzer │
│  src/agents/SubAgentManager.ts ── Swarm Worker Orchestration               │
│  ├── BrowserSubAgent.ts                                                     │
│  ├── CodingSubAgent.ts                                                      │
│  └── ResearchSubAgent.ts                                                    │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TOOL EXECUTION & SANDBOX LAYER                        │
│  src/skills/registry.ts ──────── Central Tool Registry (23 Static + Dynamic)│
│  src/skills/tools.ts ─────────── Core Tools Implementation                   │
│  src/sandbox/ ────────────────── Isolated Node.js Script Sandbox             │
│  src/sandbox/skills/ ────────── Runtime Dynamic Synthesized Skills          │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       VERIFICATION & RECOVERY LAYER                         │
│  src/core/localVerifier.ts ───── Deterministic Tool Result Matcher          │
│  src/core/verifier.ts ────────── Neural LLM Step Result Verification       │
│  src/core/recovery.ts ────────── Autonomous Self-Healing Strategy Engine    │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MULTI-LAYER MEMORY LAYER                              │
│  src/memory/manager.ts ────────── Unified Memory Engine                     │
│  ├── Layer 1: Relational Interactions Table (SQLite openclaw.db)            │
│  ├── Layer 2: Vector RAG Embeddings (MemoryVectorStore + semantic_core.json)│
│  ├── Layer 3: Structured Knowledge Facts (SQLite facts table)              │
│  └── Layer 4: Knowledge Graph Triples (KnowledgeGraphManager.ts)            │
│  src/memory/graphExtractor.ts ──── Autonomous Triple Extractor (Entity-Rel)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### System Component Responsibilities

1. **Bootstrap (`src/index.ts`)**: Initializes environment variable validation, checks critical keys (Google, Telegram, Groq, Tavily, SMTP), loads server modules, and manages graceful shutdown signals (`SIGINT`, `SIGTERM`, `SIGHUP`).
2. **Telegram Bot & Web Server (`src/integrations/telegram.ts`)**: Sets up Telegraf bot middleware, Express web server, serves React dashboard build, handles long message splitting (`safeSend`), and manages execution state.
3. **Model Router (`src/core/router.ts`)**: Implements multi-provider LLM waterfall (Groq Llama + Gemini Flash). Tracks request RPM, enforces a 25 RPM cap on Groq, manages 5-minute circuit breaker cooldowns for failing models, and formats tool declarations cleanly.
4. **Memory Manager (`src/memory/manager.ts`)**: Controls 4-tier persistent memory: SQLite relational database for interaction logs and facts, RAG vector embeddings (`text-embedding-004`) saved to `semantic_core.json`, and Knowledge Graph triples.
5. **Knowledge Graph Manager (`src/memory/KnowledgeGraphManager.ts` & `graphExtractor.ts`)**: Extracts entity-relation-entity triples (`(Subject, Relation, Object)`) using LLM structured extraction and stores them in SQLite (`kg_triples`).
6. **Planner (`src/core/planner.ts`)**: Assesses user prompt complexity. Generates 3-4 step execution plans for complex tasks and falls back to simple direct execution plans when applicable.
7. **Skill Registry & Tools (`src/skills/registry.ts` & `src/skills/tools.ts`)**: Central hub managing 23 static tools and dynamic runtime skills. Provides sandbox file writing, code execution, web search, graph querying, email reporting, and skill synthesis.
8. **Verifier Engine (`src/core/localVerifier.ts` & `src/core/verifier.ts`)**: Dual-tier verification: local regex/pattern matching for direct output validation, combined with LLM neural step verification.
9. **Recovery Engine (`src/core/recovery.ts`)**: Analyzes step failures and selects self-healing recovery strategies (e.g. `RETRY_WITH_ALTERNATIVE_TOOL`, `MODIFY_PARAMETERS`, `SIMPLIFY_STEP`, `ABORT_WITH_EXPLANATION`).
10. **Swarm Sub-Agents (`src/agents/` & `src/core/subagent.ts`)**: Autonomous worker framework (`SubAgentRunner`) executing sub-tasks in isolated scratchpad steps using specialized worker roles.

### Module Inventory Table

| File | Module | Responsibility | Primary Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- |
| [`src/index.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/index.ts) | Bootstrap Entry | Environment checking, service loading, graceful shutdown | `dotenv`, `telegram.ts` | `[VERIFIED]` |
| [`src/core/router.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/router.ts) | Model Router | Waterfall failover, rate limiting, circuit breaker | `@langchain/google-genai`, `groq-sdk` | `[VERIFIED]` |
| [`src/core/planner.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/planner.ts) | Task Planner | Complexity evaluation, step decomposition | `router.ts` | `[VERIFIED]` |
| [`src/core/conversationGuard.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/conversationGuard.ts) | Guard | Fast classification of simple vs complex queries | Native JS Regex | `[VERIFIED]` |
| [`src/core/verifier.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/verifier.ts) | Neural Verifier | LLM-based verification of step execution | `router.ts` | `[VERIFIED]` |
| [`src/core/localVerifier.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/localVerifier.ts) | Local Verifier | Fast regex/rule pattern matching of tool outputs | Native JS | `[VERIFIED]` |
| [`src/core/recovery.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/recovery.ts) | Self-Healing | Self-recovery strategy selection on failure | `router.ts` | `[VERIFIED]` |
| [`src/core/analyzer.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/analyzer.ts) | Code Analyzer | Workspace scanning and Mermaid diagram creation | `fs/promises`, `path` | `[VERIFIED]` |
| [`src/core/diplomat.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/diplomat.ts) | Diplomat | SMTP email sending via Nodemailer | `nodemailer` | `[VERIFIED]` |
| [`src/core/clockwork.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/clockwork.ts) | Task Scheduler | Background recurring cron jobs | Native JS timers | `[VERIFIED]` |
| [`src/core/goals.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/goals.ts) | Goal Engine | Long-term milestone and project goal tracking | `fs/promises` | `[VERIFIED]` |
| [`src/core/subagent.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/subagent.ts) | SubAgent Engine | Isolated child execution runner with scratchpad | `router.ts`, `registry.ts` | `[VERIFIED]` |
| [`src/core/swarm.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/swarm.ts) | Swarm Manager | Multi-agent coordination and swarm tasks | `subagent.ts` | `[VERIFIED]` |
| [`src/memory/manager.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/memory/manager.ts) | Memory Manager | Unified 4-layer memory storage engine | `sqlite3`, `@langchain/classic` | `[VERIFIED]` |
| [`src/memory/KnowledgeGraphManager.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/memory/KnowledgeGraphManager.ts) | Graph DB | Storing entity-relation triples in SQLite | `sqlite3` | `[VERIFIED]` |
| [`src/memory/graphExtractor.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/memory/graphExtractor.ts) | Graph Extractor | Extracting graph triples from text using LLM | `router.ts`, `KnowledgeGraphManager` | `[VERIFIED]` |
| [`src/skills/registry.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/registry.ts) | Tool Registry | Registering and caching static/dynamic tools | `tools.ts` | `[VERIFIED]` |
| [`src/skills/tools.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts) | Tool Suite | Implementation of 23 core agent tools | Zod, LangChain, Tavily, Nodemailer | `[VERIFIED]` |
| [`src/integrations/telegram.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/integrations/telegram.ts) | Telegram Server | Main workflow loop, message chunking, REST API | `express`, `telegraf` | `[VERIFIED]` |
| [`src/agents/SubAgentManager.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/agents/SubAgentManager.ts) | Agent Manager | Orchestrating specialized worker agents | Worker modules | `[VERIFIED]` |
| [`src/agents/workers/BrowserSubAgent.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/agents/workers/BrowserSubAgent.ts) | Browser Worker | Web research and scraping sub-agent | `router.ts` | `[VERIFIED]` |
| [`src/agents/workers/CodingSubAgent.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/agents/workers/CodingSubAgent.ts) | Coding Worker | Code generation and execution sub-agent | `router.ts`, `tools.ts` | `[VERIFIED]` |
| [`src/agents/workers/ResearchSubAgent.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/agents/workers/ResearchSubAgent.ts) | Research Worker | Deep knowledge search sub-agent | `router.ts`, `tools.ts` | `[VERIFIED]` |
| [`admin_panel.py`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/admin_panel.py) | Python Admin | Streamlit monitoring dashboard | `streamlit`, `sqlite3` | `[VERIFIED]` |
| [`dashboard/src/App.tsx`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/dashboard/src/App.tsx) | React Dashboard | Web dashboard UI for telemetry and state | React 19, Mermaid | `[VERIFIED]` |

---

## PART 4 — MODEL ROUTER / WATERFALL

Detailed technical analysis of [`src/core/router.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/core/router.ts):

### 1. All Providers
- **Google Gemini**: Managed via `ChatGoogleGenerativeAI` from `@langchain/google-genai`.
- **Groq**: Managed via official `Groq` SDK (`groq-sdk`).

### 2. Model Names
- **Primary Gemini Model**: `gemini-2.5-flash` (Overridable via `process.env.GEMINI_MODEL`).
- **Primary Groq Model**: `llama3-8b-8192` (Overridable via `process.env.GROQ_MODEL`).
- **Specialized Groq Model for Sub-Agents**: `llama-3.3-70b-versatile` (Injected dynamically when logic is `coding_subagent` or `research_subagent`).

### 3. Provider Order & Waterfall Logic
Default Static Waterfall List (`WATERFALL_PROVIDERS`):
1. Candidate 1: `groq-llama-8b` (`llama3-8b-8192` / Groq)
2. Candidate 2: `gemini-3.6-flash` (`gemini-2.5-flash` / Gemini)

Dynamic Overrides by `logic` parameter:
- **If `logic === "graph_extractor"`**: Groq candidate is unshifted to position 1 to maximize extraction speed.
- **If `logic === "coding_subagent"` or `"research_subagent"`**: Groq 70B candidate (`llama-3.3-70b-versatile`) is inserted immediately after Gemini Flash.

### 4. API Keys & Environment Variables
- **Gemini**: Checks `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_KEY`.
- **Groq**: Checks `GROQ_API_KEY` or `GROQ_KEY`.

### 5. Timeout Handling
- **Gemini Invocation Timeout**: Wrapped in `Promise.race` with a 120,000ms (120s) timer.
- **Groq Invocation Timeout**: Wrapped in `Promise.race` with a 90,000ms (90s) timer.
- **Outer Telegram Invocation Timeout**: Wrapped in a 120,000ms (120s) limit in `telegram.ts`.

### 6. Retry Mechanism & Backoff
- `invokeWithRetry(messages, mode, options, maxRetries = 3)` executes up to 3 retry attempts across the entire waterfall sequence.
- **Linear Backoff Delay**: `5000 * attempt` ms (5s on attempt 1, 10s on attempt 2, 15s on attempt 3).
- Listens to global `AbortSignal` during sleep delays to abort cleanly on timeout.

### 7. Rate-Limit Handling (Groq RPM Limiter)
- Tracks `groqCallsThisMinute` with timestamp resets every 60,000ms.
- **Cap Threshold**: If `groqCallsThisMinute > 25` (out of Groq's 30 RPM free-tier limit), the router automatically skips Groq during that cycle and fails over directly to Gemini.

### 8. Circuit Breaker & Per-Model Cooldown
- `failedModelsCooldown`: `Map<string, number>` tracking model IDs and cooldown expiration timestamps.
- When triggered, places the target model in a **5-minute (300,000ms) cooldown**.
- `isModelInCooldown(modelId)` checks if current time is less than the expiration timestamp. Clears expired entries automatically.

### 9. Failure Detection & Trigger Conditions
The router detects error codes and message patterns:
- **Model Not Found (404)**: Status 404, `model_not_found`, or string match `Model not found`. Trips circuit breaker for that candidate ID.
- **Quota / Rate Limit Exceeded (429)**: Status 429, string match `free_tier_requests`, `Quota exceeded`, or `ResourceExhausted`. Trips circuit breaker for that candidate ID.

### 10. Provider Switching Mechanism
Inside `invoke()`:
- Iterates over the ordered list of provider candidates.
- If a candidate is in cooldown or exceeds rate limits, logs a skip notice and advances to the next candidate.
- If `invokeProvider()` throws an error, logs `Waterfall Failover`, inspects error status, trips circuit breaker if necessary, and immediately attempts the next provider in the array.

### 11. Complete Failover Outcome (All Providers Exhausted)
- Inside `invoke()`: Throws explicit error: `All upstream AI providers in waterfall loop failed. Last error: ...`.
- Inside `invokeWithRetry()`: Catches final error or detects `isInFallbackMode()`, returning graceful degradation message to the user:
  `"⚠️ [System Alert] All upstream AI providers are currently unreachable. Please check network connectivity or API keys."`

---

## PART 5 — COMPLETE TOOL INVENTORY

The project features **23 static tools** registered in `SkillRegistry` ([`src/skills/registry.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/registry.ts)) and implemented in [`src/skills/tools.ts`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts), plus a **Dynamic Skill Synthesis Engine**.

---

### 1. `web_search` `[VERIFIED]`
- **Purpose**: Searches live web for real-time facts, news, and external documentation using Tavily API.
- **Input Parameters**:
  - `query` (string, required): The search query string to look up on the web.
- **Output Format**: Markdown string containing direct answer and formatted web source links with clean snippets.
- **Implementation**: [`src/skills/tools.ts:L94`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L94)

---

### 2. `local_file_system` `[VERIFIED]`
- **Purpose**: Inspects local project directory within workspace root. Lists directory entries or reads file contents (up to 100KB limit).
- **Input Parameters**:
  - `action` (enum: `"list" | "read"`, required): Action to perform.
  - `path` (string, optional): Relative or absolute path within workspace root.
- **Output Format**: Plain text directory listing or JSON string with file content.
- **Implementation**: [`src/skills/tools.ts:L153`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L153)

---

### 3. `write_sandbox_file` `[VERIFIED]`
- **Purpose**: Creates or overwrites text/code files safely inside `src/sandbox/` after stripping conversational markdown wrapper.
- **Input Parameters**:
  - `fileName` (string, required): Name of file to save in `src/sandbox/` (e.g. `'report.txt'`, `'script.js'`).
  - `content` (string, required): Text content to write.
- **Output Format**: Success message confirming path and byte size.
- **Implementation**: [`src/skills/tools.ts:L203`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L203)

---

### 4. `get_current_time` `[VERIFIED]`
- **Purpose**: Returns current system local and ISO timestamp for temporal queries.
- **Input Parameters**: None.
- **Output Format**: Formatted system timestamp string.
- **Implementation**: [`src/skills/tools.ts:L238`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L238)

---

### 5. `update_user_profile` `[VERIFIED]`
- **Purpose**: Updates persistent user facts and preferences in `user_profile.txt`.
- **Input Parameters**:
  - `name` (string, optional): User's preferred name.
  - `preferences` (string, optional): Key user preferences or facts.
- **Output Format**: Success/failure text message.
- **Implementation**: [`src/skills/tools.ts:L252`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L252)

---

### 6. `run_sandbox_code` `[VERIFIED]`
- **Purpose**: Executes a JavaScript (`.js`) file inside `src/sandbox/` using Node.js child process with 5-second execution timeout cap.
- **Input Parameters**:
  - `fileName` (string, required): Name of `.js` file in sandbox.
- **Output Format**: Execution STDOUT / STDERR string output.
- **Implementation**: [`src/skills/tools.ts:L285`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L285)

---

### 7. `synthesize_skill` `[VERIFIED]`
- **Purpose**: Synthesizes a new tool in `src/sandbox/skills/`, performs pre-compilation JS syntax checking via `new Function()`, and hot-registers it at runtime.
- **Input Parameters**:
  - `name` (string, required): Lowercase snake_case tool name (e.g. `'prime_checker'`).
  - `description` (string, required): Description of what tool does.
  - `code` (string, required): Internal JavaScript function logic body.
  - `schemaJSON` (string, required): Zod object schema definition string.
- **Output Format**: Confirmation message with registration status.
- **Implementation**: [`src/skills/tools.ts:L324`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L324)

---

### 8. `visualize_architecture` `[VERIFIED]`
- **Purpose**: Scans project workspace files and returns a Mermaid.js diagram string representing system architecture.
- **Input Parameters**: None.
- **Output Format**: Mermaid format string containing system flowchart.
- **Implementation**: [`src/skills/tools.ts:L392`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L392)

---

### 9. `ingest_to_memory` `[VERIFIED]`
- **Purpose**: Indexes raw text document from sandbox path into Layer 2 Vector Memory Store.
- **Input Parameters**:
  - `filePath` (string, required): Relative path inside sandbox (e.g. `'notes.txt'`).
- **Output Format**: Confirmation string of document ingestion.
- **Implementation**: [`src/skills/tools.ts:L410`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L410)

---

### 10. `save_knowledge` `[VERIFIED]`
- **Purpose**: Saves a structured fact record into Layer 3 Knowledge Base SQLite table (`facts`).
- **Input Parameters**:
  - `category` (string, required): Fact category (e.g. `'user_profile'`, `'project'`).
  - `key` (string, required): Unique key identifier.
  - `value` (string, required): Fact value text.
  - `confidence` (number, optional): Confidence score (default: 1.0).
- **Output Format**: Confirmation message with saved key.
- **Implementation**: [`src/skills/tools.ts:L437`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L437)

---

### 11. `get_all_knowledge` `[VERIFIED]`
- **Purpose**: Retrieves all stored fact records from Layer 3 Knowledge Base SQLite table.
- **Input Parameters**: None.
- **Output Format**: Formatted JSON array string of all stored facts.
- **Implementation**: [`src/skills/tools.ts:L458`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L458)

---

### 12. `get_memory_stats` `[VERIFIED]`
- **Purpose**: Returns operational statistics across all 4 memory layers (interactions count, facts, summaries, vector count).
- **Input Parameters**: None.
- **Output Format**: Plain text memory statistics summary.
- **Implementation**: [`src/skills/tools.ts:L474`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L474)

---

### 13. `ingest_to_long_term_memory` `[VERIFIED]`
- **Purpose**: Indexes raw text string directly into Layer 2 Vector Memory Store with source attribution.
- **Input Parameters**:
  - `text` (string, required): Raw text content to embed.
  - `source` (string, required): Source attribution name.
- **Output Format**: Ingestion confirmation string with character length.
- **Implementation**: [`src/skills/tools.ts:L489`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L489)

---

### 14. `search_memory` `[VERIFIED]`
- **Purpose**: Searches persistent memory across relational history, key-value facts, and RAG vector store embeddings.
- **Input Parameters**:
  - `query` (string, required): Search query string.
- **Output Format**: Combined text search results from memory stores.
- **Implementation**: [`src/skills/tools.ts:L508`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L508)

---

### 15. `generate_data_chart` `[VERIFIED]`
- **Purpose**: Generates interactive visual data charts using Chart.js as standalone HTML files inside `src/sandbox/`.
- **Input Parameters**:
  - `title` (string, required): Chart title header.
  - `type` (string, required): Chart type (`'bar'`, `'line'`, `'pie'`, `'doughnut'`, `'radar'`, `'polararea'`).
  - `dataJSON` (string, required): JSON string representing label/value dataset array or object.
- **Output Format**: Confirmation message with HTML file path and chart type.
- **Implementation**: [`src/skills/tools.ts:L525`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L525)

---

### 16. `run_system_audit` `[VERIFIED]`
- **Purpose**: Performs system environment health audit.
- **Input Parameters**: None.
- **Output Format**: Health audit status string.
- **Implementation**: [`src/skills/tools.ts:L687`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L687)

---

### 17. `generate_project_manual` `[VERIFIED]`
- **Purpose**: Generates full system user manual in `manual.html` inside sandbox.
- **Input Parameters**: None.
- **Output Format**: Manual generation status string.
- **Implementation**: [`src/skills/tools.ts:L697`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L697)

---

### 18. `manage_project_goals` `[VERIFIED]`
- **Purpose**: Goal management engine operation runner.
- **Input Parameters**:
  - `action` (string, required): Goal operation action name.
- **Output Format**: Goal operation result string.
- **Implementation**: [`src/skills/tools.ts:L707`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L707)

---

### 19. `scrape_website` `[VERIFIED]`
- **Purpose**: Scrapes webpage text content from target web URL.
- **Input Parameters**:
  - `url` (string, required): Web page URL to scrape.
- **Output Format**: Scraped text preview snippet string.
- **Implementation**: [`src/skills/tools.ts:L718`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L718)

---

### 20. `delegate_task` `[VERIFIED]`
- **Purpose**: Assigns a sub-task goal to an isolated child `SubAgentRunner`. Executes up to 3 tool steps in an isolated scratchpad and returns a summary report.
- **Input Parameters**:
  - `role` (enum: `"Researcher" | "Coder" | "Analyst" | "Writer" | "QA_Engineer"`, required): Specialized sub-agent role persona.
  - `task` (string, required): Detailed sub-task prompt description.
- **Output Format**: Structured report string with status, summary, and scratchpad logs.
- **Implementation**: [`src/skills/tools.ts:L729`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L729)

---

### 21. `send_email_report` `[VERIFIED]`
- **Purpose**: Sends executive HTML email reports over SMTP via Diplomat module and Nodemailer.
- **Input Parameters**:
  - `to` (string, required): Recipient email address.
  - `subject` (string, required): Subject line.
  - `body` (string, required): Email body content.
- **Output Format**: Delivery status confirmation string.
- **Implementation**: [`src/skills/tools.ts:L749`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L749)

---

### 22. `manage_scheduled_tasks` `[VERIFIED]`
- **Purpose**: Manages background cron and scheduled tasks via Clockwork engine.
- **Input Parameters**:
  - `action` (string, required): Action name for scheduled tasks.
- **Output Format**: Task management status string.
- **Implementation**: [`src/skills/tools.ts:L775`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L775)

---

### 23. `manage_git_repository` `[VERIFIED]`
- **Purpose**: Executes Git repository operations (status, commit, log) using `simple-git`.
- **Input Parameters**:
  - `action` (string, required): Git command action name.
- **Output Format**: Git operational output string.
- **Implementation**: [`src/skills/tools.ts:L786`](file:///c:/Users/Roqaiah%20Anjum%20E/OneDrive/Attachments/Desktop/my%20project/open%20claw%20project/src/skills/tools.ts#L786)

---

## Audit Summary & Final Checklist
- **Total Registered Tools Audited**: 23 Static Tools + 1 Dynamic Synthesis Mechanism `[VERIFIED]`.
- **Model Router Providers Verified**: Google Gemini (`gemini-2.5-flash`) + Groq (`llama-3.3-70b`, `llama3-8b-8192`) `[VERIFIED]`.
- **Memory Layers Verified**: SQLite3 (`openclaw.db`), Vector RAG (`semantic_core.json`), Fact Store (`facts`), Knowledge Graph (`kg_triples`) `[VERIFIED]`.
- **Verification & Self-Healing Verified**: Neural + Deterministic local regex pattern verifier + Recovery strategy engine `[VERIFIED]`.
- **Deployment & Admin Interfaces Verified**: Telegram Bot API (`telegraf`), React 19 Dashboard (`dashboard/`), Streamlit Admin Panel (`admin_panel.py`) `[VERIFIED]`.
