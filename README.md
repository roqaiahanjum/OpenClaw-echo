<div align="center">

# 🤖 OpenClaw Echo `v1.0.0`

**A Resilient, Multi-Tenant Autonomous AI Agent Framework with Multi-Provider Routing, 4-Layer Turso Persistent Memory, GraphRAG, and Sandbox Isolation.**

[![Version](https://img.shields.io/badge/Release-v1.0.0--Restricted--Go-blue?style=for-the-badge)](https://github.com/roqaiahanjum/OpenClaw-echo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Turso](https://img.shields.io/badge/Turso-Cloud_SQLite-4FF8D2?style=for-the-badge&logo=sqlite&logoColor=black)](https://turso.tech/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-2.5_Flash-8E75B2?style=for-the-badge&logo=googlebard&logoColor=white)](https://aistudio.google.com/)
[![Groq](https://img.shields.io/badge/Groq-Llama_3_8B-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Telegraf-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://telegram.org/)
[![Tests](https://img.shields.io/badge/Tests-100%25_Passing-brightgreen?style=for-the-badge)](https://github.com/roqaiahanjum/OpenClaw-echo)

</div>

---

## 📖 Overview

**OpenClaw Echo v1.0.0** is an enterprise-grade autonomous AI agent framework built in TypeScript. Engineered for high availability, multi-step task delegation, resilient cloud persistence, and strict tenant isolation, OpenClaw Echo operates seamlessly through a **Telegram Bot interface** and an Express telemetry backend.

OpenClaw Echo features a multi-provider model routing waterfall (Groq Fast + Google Gemini Flash), durable multi-tenant memory backed by **Turso Cloud SQLite**, autonomous multi-agent swarms (ACP protocol), and an honest, security-gated coding sandbox.

---

## 🔑 Key Architectural Capabilities

### 1. Multi-Provider Waterfall Router
- **Primary Fast Engine:** Routes requests through **Groq (Llama 3 8B)** for sub-second classification and reasoning.
- **Failover Cascade:** Automatically falls back to **Google Gemini 2.5 Flash** on rate limits (`HTTP 429`), network timeouts, or quota errors.
- **Circuit Breakers:** Features independent 5-minute cooldown timers per provider with exponential backoff and jitter.

### 2. 4-Layer Multi-Tenant Memory + GraphRAG
Durable, isolated persistent storage powered by **Turso Cloud SQLite** (native HTTP Pipeline REST protocol) and local fallback:
1. **Layer 1 (Short-Term Dialogue):** Turn-by-turn conversation history partitioned strictly by `chat_id` and user ID.
2. **Layer 2 (Vector Semantic Retrieval):** 768-dim semantic vector store with **tenant metadata pre-filtering**. Untagged legacy vectors are blocked, and modified facts immediately invalidate and refresh cached vector representations.
3. **Layer 3 (Structured Knowledge Facts):** Key-value facts scoped per tenant (`[tenant_id][category] key: value`) for user preferences and project configurations.
4. **Layer 4 (Summaries):** Hierarchical conversation summaries isolated per chat with automatic schema migrations (`chat_id` column).
5. **GraphRAG:** Dual regex and LLM triple extraction (`subject -> predicate -> object`) with relational sub-graph traversals.

### 3. Agent Communication Protocol (ACP) Worker Swarm
Decomposes complex requests into structured sub-tasks executed by specialized worker agents:
- **`ConversationSubAgent`:** Context-aware dialogue handler with educational fast-paths (eliminates unnecessary web searches for basic conceptual queries).
- **`ResearchSubAgent`:** Grounded web search and knowledge synthesis using Tavily search and structured citation extraction.
- **`CodingSubAgent`:** Multi-language code synthesis (TypeScript, JavaScript, Python) with AST syntax verification, disk verification, and security policy gates.
- **`MemorySubAgent`:** Autonomous fact extraction and profile lifecycle management.
- **`BrowserSubAgent`:** Headless page inspection and content extraction.
- **`PlannerSubAgent`:** Decomposes complex user goals into dependency-ordered DAGs.

### 4. Sandbox Security & RESTRICTED GO Release Policy
To prevent host resource compromise and remote code execution vulnerabilities in public multi-tenant environments:
- **Default Policy (`ENABLE_SANDBOX_EXECUTION=false`):** Untrusted child-process execution is disabled by default in production.
- **Fully Available Capabilities:** High-fidelity code generation, static AST syntax validation, safe disk file persistence, and verified file reporting remain 100% operational.
- **Honest Execution Reporting:** Transparently outputs:
  ```markdown
  ⚙️ **Execution Status**: BLOCKED BY SECURITY POLICY
  ```
  ```text
  Security Notice: Untrusted code execution is disabled in public production v1.0.0. Code generation, static syntax analysis, and safe file creation remain fully available.
  ```
- **Strict Verification Guarantee:** Never falsely claims code was executed unless child-process execution genuinely succeeded.

---

## 🏗️ System Architecture Flow

```
   [User Request] (Telegram / Web API)
          │
          ▼
   [Telegram Webhook & Route Handler]
          │
          ├──────────► Simple Educational / Conversational ──► [Direct Synthesis]
          │
          ▼
   [MemoryManager.getContext(tenantId)]
   ├── Layer 1: Tenant Dialogue Turns
   ├── Layer 2: Scoped Vector Search (text-embedding-004 + Tenant Pre-filter)
   ├── Layer 3: Scoped Structured Facts ([tenant_id][cat] key: val)
   ├── Layer 4: Scoped Summaries
   └── GraphRAG: Relational Sub-Graph Traversal
          │
          ▼
   [Intent Classifier & Planner]
          │
          ▼
   [SubAgentManager Worker Dispatch]
   ├── ConversationSubAgent
   ├── ResearchSubAgent (Tavily Grounding)
   ├── CodingSubAgent (AST Verification + Policy Gate)
   └── PlannerSubAgent (Multi-Wave DAG Execution)
          │
          ▼
   [ModelRouter (Groq ──► Gemini 2.5 Flash Fallback)]
          │
          ▼
   [Verification Layer & Tool Honesty Guard]
          │
          ▼
   [Turso Cloud Persistence & Telegram Delivery]
```

---

## 🛠️ Technology Stack

| Component | Technologies Used |
| :--- | :--- |
| **Language & Runtime** | Node.js (v22.12+), TypeScript (v5.6) |
| **Web Server & Routing** | Express.js, Telegraf 4.x (Telegram Bot API) |
| **AI Providers** | Groq SDK (`llama3-8b-8192`), Google Gemini (`gemini-2.5-flash`), Google Embeddings (`text-embedding-004`) |
| **Database & Persistence** | Turso Cloud SQLite (`@libsql/client` / HTTP Pipeline), SQLite3 local fallback |
| **Search & Grounding** | Tavily Search API, Cheerio web scraping |
| **Dashboard & UI** | React 19, Vite, TailwindCSS, Server-Sent Events (SSE) |
| **Testing & CI** | Jest, TypeScript AST parser (`ts.createSourceFile`), Custom Security Regression Suite |
| **Cloud Deployment** | Render Web Service (`https://openclaw-echo.onrender.com`), Docker, PM2 |

---

## 📂 Directory Structure

```text
OpenClaw Echo
├── .env.example              # Environment variables template
├── .gitignore                # Strict ignore patterns (secrets & DBs protected)
├── render.yaml               # Render Cloud deployment blueprint
├── package.json              # Project scripts and dependencies
├── tsconfig.json             # TypeScript compiler configuration
├── test_security_isolation_regression.ts # 9-point security regression suite
├── src/
│   ├── index.ts              # Server bootstrap and startup validation
│   ├── agents/               # Sub-agent ACP orchestrator and workers
│   │   ├── SubAgentManager.ts
│   │   ├── types.ts
│   │   └── workers/          # Conversation, Coding, Research, Memory, Planner workers
│   ├── core/                 # Router, planner, verifiers, recovery, auth, storage
│   │   ├── router.ts         # Multi-provider waterfall router
│   │   ├── auth.ts           # HMAC token authentication & access control
│   │   ├── storage.ts        # Storage directories and database paths
│   │   └── startupValidator.ts # Pre-flight diagnostic reporter
│   ├── integrations/         # Telegram bot and Express HTTP endpoints
│   │   └── telegram.ts       # Bot update handling, chunking, and health probes
│   ├── memory/               # 4-Layer memory engine and Turso database adapter
│   │   ├── manager.ts        # MemoryManager orchestration
│   │   ├── dbAdapter.ts      # Turso Cloud HTTP Pipeline database adapter
│   │   └── graphEngine.ts    # GraphRAG extraction and search
│   ├── sandbox/              # Isolated directory for code generation and verification
│   └── skills/               # Tool registry (registry.ts) and 25 tools (tools.ts)
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** >= 22.12.0
- **Telegram Bot Token** (via [@BotFather](https://t.me/botfather))
- **Google AI Studio API Key** (Gemini & Embeddings)
- **Groq API Key** (Llama 3 8B)
- **Turso Database URL & Auth Token** (Optional for cloud memory; defaults to local SQLite)

### 2. Installation
```bash
git clone https://github.com/roqaiahanjum/OpenClaw-echo.git
cd OpenClaw-echo
npm install
```

### 3. Environment Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
Configure your keys in `.env` (this file is excluded from Git tracking):
```env
# Required AI Model Keys
GOOGLE_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here

# Telegram Configuration
TELEGRAM_TOKEN=your_telegram_bot_token_here
TELEGRAM_MODE=polling # or webhook

# Persistent Memory (Turso Cloud)
DATABASE_DRIVER=turso
TURSO_DATABASE_URL=https://your-database-name.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here

# Sandbox Security Policy
ENABLE_SANDBOX_EXECUTION=false # set to true only in isolated containerized environments

# Research & Scraping (Optional)
TAVILY_API_KEY=your_tavily_api_key_here
```

### 4. Build and Run
```bash
# Build Dashboard and Server
npm run build

# Run in Development Mode
npm run dev

# Run Production Server
npm start
```

---

## 🧪 Testing & Verification

OpenClaw Echo maintains a strict zero-regression release gate:

```bash
# 1. Typecheck
npx tsc --noEmit

# 2. Run Jest Core Test Suites
npm test

# 3. Run Security Isolation & Policy Regression Suite
npx ts-node test_security_isolation_regression.ts
```

### Verified Test Suite Results:
- **Jest Unit & Integration:** 10/10 tests passed (100%).
- **Security Regression Suite:** 9/9 tests passed (100%):
  1. *Layer 1 & Layer 3 Strict Tenant Isolation* (User A vs User B) -> **PASS**
  2. *Layer 2 Semantic Vector Search Tenant Isolation* -> **PASS**
  3. *Layer 4 Summaries Isolation* -> **PASS**
  4. *Full MemoryManager.getContext Zero-Leakage* -> **PASS**
  5. *Stale Vector Invalidation on Fact Update* -> **PASS**
  6. *Tool Contract Normalization (`fileName` / `filename`)* -> **PASS**
  7. *runSandboxCodeTool Normalization* -> **PASS**
  8. *CodingSubAgent E2E Creation & Verification* -> **PASS**
  9. *CodingSubAgent BLOCKED BY SECURITY POLICY Honest Reporting* -> **PASS**

---

## 📡 Production Endpoints

| Endpoint | Method | Purpose | Response |
| :--- | :--- | :--- | :--- |
| `/readyz` | `GET` | Health readiness check (Database, Router, Auth) | `HTTP 200 {"status":"ready",...}` |
| `/healthz` | `GET` | Liveness probe | `HTTP 200 {"status":"alive"}` |
| `/api/status` | `GET` | Diagnostic status report (Skills, Memory, Fallback mode) | `HTTP 200 JSON` |
| `/api/chat` | `POST` | Web interface message processing | `HTTP 200 {"response": "..."}` |
| `/api/webhook` | `POST` | Telegram bot webhook intake | `HTTP 200 "OK"` |

---

## 🔒 Security & Privacy

- **Zero Secrets in Repository:** Strict `.gitignore` rules prevent staging or committing `.env`, `*.env`, database binaries, or private logs.
- **Tenant Isolation:** Enforced at query and storage boundaries across all memory layers.
- **Sandboxed Execution:** Untrusted code execution is disabled by default in public instances. Code generation and syntax analysis remain safe and deterministic.

---

<div align="center">
  <b>OpenClaw Echo v1.0.0</b> • <i>Autonomous • Resilient • Secure</i>
</div>
