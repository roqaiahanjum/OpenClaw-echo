# Technical Architecture Audit: OpenClaw Echo

**Author / Auditor:** Senior AI Research Engineer & IEEE Research Validation Specialist  
**Target Repository:** OpenClaw Echo (`roqaiahanjum/OpenClaw-echo`)  
**Audit Date:** October 2026  
**Manuscript Target:** IEEE Access  

---

## 1. Executive Summary

This audit provides a comprehensive, ground-truth inspection of the **OpenClaw Echo** codebase. Each architectural component described in project documentation and the README was verified against the active TypeScript source files in `src/`. 

### Key Findings Summary:
- **Agents & Concurrency:** The three sub-agents (`ResearchSubAgent`, `CodingSubAgent`, `BrowserSubAgent`) and the `SubAgentManager` are genuinely implemented in TypeScript with asynchronous parallel execution via `Promise.all()`.
- **Model Routing:** A multi-provider waterfall routing engine with stateful circuit breaking is implemented in `src/core/router.ts`. However, the active candidate provider order in code defaults to **Groq Fast as primary** and **Gemini as secondary fallback**, contrasting with documentation claiming Gemini 2.5 Flash is primary.
- **Memory Architecture:** The 4-layer memory hierarchy (SQLite history, LangChain `MemoryVectorStore`, key-value fact store, and BFS Knowledge Graph traversal) is implemented across `src/memory/manager.ts` and `src/memory/KnowledgeGraphManager.ts`. In code, the embedding model initialized is `gemini-embedding-001` (3072 dimensions) rather than `text-embedding-004` (768 dimensions) stated in documentation.
- **Verification & Self-Healing:** A dual-tier verification engine (`localVerifier.ts` + `verifier.ts`) and recovery state machine (`recovery.ts`) are implemented in code.
- **Tools & Sandbox:** 23 functional tools are typed via Zod schemas and registered in `src/skills/registry.ts`. Code execution in `src/sandbox/` enforces basic path restrictions, timeouts, and AST pre-compilation checks.

---

## 2. Component-by-Component Architectural Audit

### 2.1 Sub-Agent Swarm (ACP Protocol Delegation)

#### Implemented Files:
- `src/agents/SubAgentManager.ts`
- `src/agents/types.ts`
- `src/agents/workers/ResearchSubAgent.ts`
- `src/agents/workers/CodingSubAgent.ts`
- `src/agents/workers/BrowserSubAgent.ts`

#### Verified Behavior:
1. **Orchestrator (`SubAgentManager`):**
   - Implemented as a Singleton (`SubAgentManager.getInstance()`).
   - Automatically registers three worker agents on instantiation (`ResearchSubAgent`, `CodingSubAgent`, `BrowserSubAgent`).
   - Implements two delegation paradigms:
     - `delegateTasksParallel(tasks: ACPTask[])`: Dispatches independent sub-tasks concurrently via native `Promise.all()`.
     - `delegateTasksWithDependencies(tasks: ACPTask[])`: Implements a dependency resolution loop for sequential task Directed Acyclic Graphs (DAGs), propagating output payloads into subsequent sub-agent context (`ready.contextPayload.prerequisiteFindings`).
2. **`ResearchSubAgent` (`src/agents/workers/ResearchSubAgent.ts`):**
   - Extracts regex-based search queries from `task.taskDescription`.
   - Invokes `webSearchTool` from `SkillRegistry`.
   - Performs a 2-hop BFS Knowledge Graph traversal (`KnowledgeGraphManager.getInstance().traverseSubGraph(seedKeywords, 2)`) to augment research findings with relational context.
   - Synthesizes findings using `ModelRouter.getInstance().invoke()`.
3. **`CodingSubAgent` (`src/agents/workers/CodingSubAgent.ts`):**
   - Analyzes tasks to generate or modify TypeScript/JavaScript files in `src/sandbox/`.
   - Employs TypeScript compiler API (`ts.transpileModule` / `validateCodeSafety`) to detect dangerous AST syntax (e.g., unauthorized file system access, network socket calls).
   - Executes code inside isolated Node.js child processes with stdout/stderr capture and truncation limits.
4. **`BrowserSubAgent` (`src/agents/workers/BrowserSubAgent.ts`):**
   - Extracts URLs from task descriptions or context payloads.
   - Enforces SSRF (Server-Side Request Forgery) protection via `isSafePublicUrl()` in `src/skills/tools.ts`, rejecting localhost, loopback (`127.0.0.1`), private RFC1918 subnets, and metadata endpoints (`169.254.169.254`).
   - Invokes `scrapeWebsiteTool` using Cheerio and Axios.

#### Discrepancies & Limitations:
- The sub-agent protocol is termed "ACP" (Agent Communication Protocol) in code, but represents an internal TypeScript interface (`ACPTask` / `ACPResult`) rather than an open network protocol (such as FIPA-ACL or standardized WebSocket ACP).

---

### 2.2 Task Planner & Complexity Guard

#### Implemented Files:
- `src/core/planner.ts`
- `src/core/conversationGuard.ts`

#### Verified Behavior:
1. **Deterministic Complexity Guard (`evaluatePlanComplexity`):**
   - Inspects input text without invoking an LLM.
   - Flags input as complex if it contains conjunctions (`"and then"`, `"first"`, `"after that"`, `"compare"`, `"contrast"`, `"research and write"`) or exceeds 15 words.
   - Fast-paths simple search queries (`"search"`, `"find"`, `"look up"`) into a local 2-step execution plan without LLM planner overhead.
2. **Neural LLM Planner (`generatePlan`):**
   - Calls `ModelRouter` with a strict JSON schema prompt requesting a structured plan (`goal` and `steps`).
   - Applies an `AbortController` timeout budget of 7,000 ms to prevent orchestrator stalls.
3. **Smart Planner Wrapper (`generateSmartPlan`):**
   - Bypasses the LLM planner call if `ModelRouter.isInFallbackMode()` is active or if `evaluatePlanComplexity` determines the query is simple, preventing redundant token expenditure.

---

### 2.3 Model Router & Waterfall Circuit Breaker

#### Implemented Files:
- `src/core/router.ts`

#### Verified Behavior:
1. **Provider Registry (`WATERFALL_PROVIDERS`):**
   - Defined in `src/core/router.ts` (lines 92–97):
     ```typescript
     const WATERFALL_PROVIDERS: ProviderCandidate[] = [
         { id: "groq-fast", name: "Groq Fast", provider: "groq", modelName: cleanModelName(process.env.GROQ_MODEL, "openai/gpt-oss-20b") },
         { id: "gemini-flash", name: "Gemini Flash", provider: "gemini", modelName: cleanModelName(process.env.GEMINI_MODEL, "gemini-3.5-flash-lite") },
         { id: "groq-backup", name: "Groq Backup", provider: "groq", modelName: "openai/gpt-oss-120b" },
         { id: "gemini-fallback", name: "Gemini 3.5 Flash Lite Backup", provider: "gemini", modelName: "gemini-3.5-flash-lite" }
     ];
     ```
2. **Circuit Breaker Logic:**
   - Tracks model failure timestamps in `failedModelsCooldown` Map.
   - When a 429 quota exhaustion error or 30s timeout occurs, `tripCircuitBreakerForModel()` sets a 5-minute cooldown (`Date.now() + 5 * 60 * 1000`).
   - Subsequent calls check `isModelInCooldown()`; if active, the provider is immediately bypassed without incurring HTTP timeout delays.
3. **Payload Normalization (`translateMessagesToGroq`):**
   - Translates LangChain message structures (`SystemMessage`, `HumanMessage`, `AIMessage`) into OpenAI-compatible dictionaries for Groq SDK execution.

#### Critical Discrepancies:
- **Provider Order Inversion:** Documentation and reports state Gemini is the primary provider and Groq is the fallback. However, in `src/core/router.ts`, `groq-fast` is the first element in `WATERFALL_PROVIDERS`.
- **Candidate ID Mismatch:** Legacy tests in root (`run_circuit_breaker_refactor_test.ts`) expect candidate IDs `"groq-llama-8b"` and `"gemini-flash-2.5"`, whereas the active router uses `"groq-fast"` and `"gemini-flash"`.

---

### 2.4 Hybrid Memory Architecture & GraphRAG

#### Implemented Files:
- `src/memory/manager.ts`
- `src/memory/KnowledgeGraphManager.ts`
- `src/memory/graphExtractor.ts`

#### Verified Behavior:
1. **Layer 1 (Conversational Interaction History):**
   - Stored in SQLite table `interactions` (`id`, `chat_id`, `user_msg`, `agent_res`, `timestamp`).
   - Retrieves the last $N$ turns per chat ID.
2. **Layer 2 (Semantic Vector Store):**
   - Uses LangChain's `@langchain/classic/vectorstores/memory` (`MemoryVectorStore`).
   - Persisted to disk via JSON serialization (`src/memory/semantic_core.json`).
   - Loaded on startup with dimensionality validation.
3. **Layer 3 (Relational Fact Store):**
   - Stored in SQLite table `knowledge` (`id`, `category`, `key`, `value`, `confidence`, `timestamp`).
   - Deduplication and conflict resolution logic: identical key/value updates the timestamp; altered value replaces the entry and logs a conflict resolution event.
4. **Layer 4 / GraphRAG (Knowledge Graph Triples):**
   - Stored in SQLite tables `graph_entities` and `graph_triples` (`subject_id`, `subject_name`, `predicate`, `object_id`, `object_name`, `confidence`).
   - `KnowledgeGraphManager.traverseSubGraph(seedKeywords, maxDepth)` performs Breadth-First Search (BFS) graph traversal across entity nodes.
   - `graphExtractor.ts` extracts Subject-Predicate-Object triples using regex pattern heuristics and optional LLM fallback.

#### Discrepancies:
- **Embedding Model & Dimensionality:** Documentation claims Google `text-embedding-004` (768 dimensions). The active implementation in `src/memory/manager.ts` (line 68 and line 144) specifies `gemini-embedding-001` and checks `item.embedding.length === 3072`.
- **Database Table Names:** Documentation references table `facts` and `kg_triples`, while the actual SQLite tables created in code are `knowledge`, `graph_entities`, and `graph_triples`.

---

### 2.5 Verification & Self-Healing Recovery

#### Implemented Files:
- `src/core/localVerifier.ts`
- `src/core/verifier.ts`
- `src/core/recovery.ts`

#### Verified Behavior:
1. **Deterministic Local Verifier (`localVerifyToolResult`):**
   - Zero-latency evaluation without LLM calls.
   - Evaluates outputs of `web_search`, `run_sandbox_code`, `write_sandbox_file`, `manage_project_goals`, `manage_git_repository`, and `get_memory_stats`.
   - Returns status `"pass"`, `"fail"`, or `"uncertain"`.
2. **Neural LLM Verifier (`verifyStepResult`):**
   - Invoked only when local verification returns `"uncertain"`.
   - Sends the user goal and tool output to the LLM to verify task step success.
3. **Recovery Strategy Engine (`determineRecoveryStrategy`):**
   - Evaluates failed tool executions.
   - Finite State Machine selects one of five strategies: `"modify_args"`, `"alternative_tool"`, `"retry_same"`, `"replan"`, or `"abort"`.
   - Limits retry attempts to a maximum of 2 before forcing `"abort"`.

---

### 2.6 Tool Registry & Sandboxing Restrictions

#### Implemented Files:
- `src/skills/registry.ts`
- `src/skills/tools.ts`
- `src/sandbox/`

#### Verified Behavior:
1. **Registry (`SkillRegistry`):**
   - 23 functional tools registered with Zod schemas.
   - Tools cover web search, scraping, file operations, memory manipulation, Chart.js generation, git operations, and SMTP emailing.
2. **Dynamic Skill Synthesis (`synthesizeSkillTool`):**
   - Dynamically writes JavaScript functions into `src/sandbox/skills/`.
   - Validates syntax using Node.js `vm.Script` before saving to disk.
3. **Sandbox Restrictions:**
   - Script execution is confined to `src/sandbox/`.
   - Path traversal (`../`) is blocked by `path.resolve` checks.
   - Child process executions have a 15,000 ms timeout and stripped environment variables.

---

### 2.7 User Integrations & Deployment

#### Implemented Files:
- `src/integrations/telegram.ts`
- `src/integrations/telemetry.ts`
- `dashboard/` (React 19 + Vite)
- `admin_panel.py` (Streamlit)

#### Verified Behavior:
1. **Telegram Bot:**
   - Built on `telegraf` v4.16.
   - Implements `splitTelegramMessage` to split messages at 3,800 characters while preserving code block Markdown fences (` ``` `).
   - Handles Markdown parse errors by falling back to plain text delivery.
2. **Web Telemetry:**
   - Express server on port 3005 provides Server-Sent Events (SSE) broadcasting agent status and memory statistics.
   - React 19 SPA in `dashboard/` consumes the telemetry stream.
3. **Admin Panel:**
   - Python Streamlit dashboard (`admin_panel.py`) connecting directly to `openclaw.db` for administrative inspection.

---

## 3. Verified vs. Documented Feature Matrix

| Feature / Claim | Documented Claim | Source Code Reality | Status |
| :--- | :--- | :--- | :---: |
| **Sub-Agent Swarm** | 3 specialized sub-agents running concurrently | Implemented in `SubAgentManager.ts` with `Promise.all` | **VERIFIED** |
| **Dynamic Skill Synthesis** | Runtime JavaScript tool generation & hot-loading | Implemented in `synthesizeSkillTool` with `vm.Script` checks | **VERIFIED** |
| **Fast-Path Conversation Guard** | Bypasses planner for greetings & search | Implemented in `conversationGuard.ts` & `planner.ts` | **VERIFIED** |
| **Dual-Tier Verification** | Local deterministic + Neural LLM verifiers | Implemented in `localVerifier.ts` & `verifier.ts` | **VERIFIED** |
| **Telegram Message Chunking** | Splits > 4096 chars & preserves code fences | Implemented in `splitTelegramMessage` in `telegram.ts` | **VERIFIED** |
| **Primary LLM Provider** | Gemini 2.5 Flash is Primary | `groq-fast` is listed first in `WATERFALL_PROVIDERS` | **DISCREPANCY** |
| **Embedding Model** | Google `text-embedding-004` (768-dim) | `gemini-embedding-001` (3072-dim) in `manager.ts` | **DISCREPANCY** |
| **Relational Fact Table** | Table named `facts` | Table created is `knowledge` in `manager.ts` | **DISCREPANCY** |
| **Graph Triple Table** | Table named `kg_triples` | Table created is `graph_triples` in `KnowledgeGraphManager.ts` | **DISCREPANCY** |
| **ChromaDB Integration** | Vector database listed in `package.json` | Replaced by `@langchain/classic` `MemoryVectorStore` | **PARTIAL** |
| **Ollama Edge Execution** | Local LLM fallback in production | Explicitly offline in `router.ts` health checks | **OFFLINE** |
