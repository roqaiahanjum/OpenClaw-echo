# OpenClaw Echo — Final Year Engineering Review 2 Demonstration Guide

**Project:** OpenClaw Echo — Autonomous Multi-Agent AI Assistant  
**Evaluation Phase:** Phase 2, Review 2  
**Intended Audience:** Project Evaluators, Review Committee, Viva Panel  

---

## 1. Quick Startup Instructions

### 1.1 Prerequisites Verification
Ensure your environment meets the minimum requirements before the demonstration:
- **Node.js**: v20+ or v24+ (`node -v`)
- **TypeScript**: v5.5+ (`npx tsc --version`)
- **Active Internet Connection** (for Telegram Bot polling and live LLM endpoints)
- **Database**: SQLite `openclaw.db` (auto-created on startup)

### 1.2 Environment File (`.env`)
Verify that `.env` contains valid credentials:
```env
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
GROQ_API_KEY="your_groq_api_key"
GEMINI_API_KEY="your_gemini_api_key"
PORT=3000
```

### 1.3 Launch Commands
Open your terminal in the project root directory:

```bash
# Option A: Standard Development Mode (with hot-reload)
npm run dev

# Option B: Direct Execution
node -r ts-node/register src/index.ts
```

**Expected Startup Log in Terminal:**
```
[Database] SQLite Database initialized at openclaw.db
[Memory] 4-Layer Vector Store initialized.
[Router] Service initialized (Gemini + Groq Multi-Provider Waterfall Engine).
[Telegram] Bot started and polling for incoming updates...
OpenClaw Echo is ready for demonstration.
```

---

## 2. Recommended Demonstration Flow (Step-by-Step)

To impress the review committee, demonstrate the system's capabilities in the following logical sequence:

```
Step 1: Conversational Disambiguation  ──► Direct Fast Response (< 1 sec)
Step 2: Deep Research (Research Agent) ──► Sources, Synthesis, Zero Unwanted Code
Step 3: Web Browsing (Browser Agent)   ──► Real Web Extraction with Source Link
Step 4: Code Generation & AST Verify   ──► Verified on Disk, Execution: NOT REQUESTED
Step 5: Code Execution in Sandbox      ──► TS AST Check, Sandboxed Run, Real Stdout
Step 6: Multi-Agent Collaboration      ──► ResearchSubAgent ➡️ CodingSubAgent Handshake
Step 7: 4-Layer Memory Recall          ──► Cross-session persistent fact retrieval
```

---

## 3. Recommended Prompts for the Live Demonstration

### Demo 1: Direct Conversational Response (Baseline)
* **Goal:** Prove that simple queries do NOT waste resources on subagent swarms.
* **Telegram Input Prompt:**
  ```text
  Hello! What are you and how do you operate?
  ```
* **Expected Telegram Output:**
  - Fast response (< 1.5 seconds)
  - Clear conversational summary explaining the multi-agent architecture
  - No subagent dispatch banner

---

### Demo 2: Research-Only Task (Validating Bug 1 Fix)
* **Goal:** Prove that technical research topics (even mentioning programming languages) do **NOT** spawn unwanted TypeScript code files.
* **Telegram Input Prompt:**
  ```text
  Research TypeScript 5.5 features and write a summary
  ```
* **Expected Telegram Output:**
  - Routed directly to `ResearchSubAgent`
  - Concise bulleted summary of TypeScript 5.5 features (e.g., Inferred Type Predicates, Regular Expression Syntax Checking)
  - Clean Telegram formatting: `🔬 *Research Summary*`
  - Source citations included
  - **Zero TypeScript code blocks or files created**

---

### Demo 3: Live Web Browsing & Documentation Extraction
* **Goal:** Demonstrate real-time web scraping with SSRF security protection.
* **Telegram Input Prompt:**
  ```text
  Browse https://nodejs.org and summarize the homepage release notes
  ```
* **Expected Telegram Output:**
  - Routed to `BrowserSubAgent`
  - Concise synthesis of Node.js current release highlights
  - Clean Telegram formatting: `🌐 *Web Documentation Insights*`
  - Clickable markdown link to `[https://nodejs.org](https://nodejs.org)`

---

### Demo 4: Pure Code Generation & AST Validation (Without Execution)
* **Goal:** Demonstrate safe sandbox file creation, TypeScript AST syntax validation, and accurate task status reporting (proving that execution success is never claimed prematurely).
* **Telegram Input Prompt:**
  ```text
  Write a TypeScript function to check if a number is prime and save to prime_check.ts
  ```
* **Expected Telegram Output:**
  ```markdown
  💻 *Coding & Sandbox Verification Report*
  • *Code Generation:* COMPLETED ✅
  • *AST Syntax Check:* PASSED ✅
  • *Sandbox Safety:* PASSED ✅
  • *File Location:* `src/sandbox/prime_check.ts` (1420 bytes ✅)
  • *Execution Status:* NOT REQUESTED ℹ️

  *Execution Details:*
  ⚙️ **Execution Status**: NOT EXECUTED (Code was generated and verified; execution was not explicitly requested).
  ```

---

### Demo 5: Sandboxed Code Execution
* **Goal:** Demonstrate genuine code execution inside the restricted sandbox environment with captured stdout.
* **Telegram Input Prompt:**
  ```text
  Write a TypeScript script that prints the first 10 Fibonacci numbers and run the code now
  ```
* **Expected Telegram Output:**
  - Status header: `• *Execution Status:* EXECUTED SUCCESSFULLY ✅`
  - Sandbox output showing the actual computed Fibonacci sequence:
    ```text
    0, 1, 1, 2, 3, 5, 8, 13, 21, 34
    ```

---

### Demo 6: Multi-Agent Swarm Orchestration
* **Goal:** Demonstrate complex decomposition, dependency graph execution, and inter-agent data passing.
* **Telegram Input Prompt:**
  ```text
  Research the top 3 AI agent frameworks and generate a comparison benchmark script in sandbox
  ```
* **Expected Telegram Output:**
  - Multi-stage progress breakdown:
    ```markdown
    🤖 *OpenClaw Multi-Agent Orchestration*
    ════════════════════════════════════════

    *Stage 1: Research & Synthesis (ResearchSubAgent)*
    • Status: COMPLETED ✅
    [Concise summary of LangChain, AutoGen, and CrewAI]

    *Stage 2: Technical Artifact Generation (CodingSubAgent)*
    • Status: COMPLETED ✅
    • File Location: `src/sandbox/agent_benchmark.ts`
    • Execution Status: NOT REQUESTED ℹ️
    ```

---

### Demo 7: 4-Layer Memory Recall
* **Goal:** Prove long-term personalization and knowledge graph extraction across sessions.
* **Telegram Input Prompt 1 (Storage):**
  ```text
  Remember this: My final year project partner is Alex and we are presenting Review 2.
  ```
* **Telegram Input Prompt 2 (Retrieval - can be asked after other questions):**
  ```text
  Who is my project partner and what are we presenting?
  ```
* **Expected Telegram Output:**
  - Instant recall from Layer 3 (Knowledge Graph) and Layer 2 (Vector Store):
    *"Your project partner is Alex, and you are presenting Review 2 for your final year project."*

---

## 4. Viva Defense Cheat Sheet (Committee Q&A)

### Q1: How does the system decide which agent to invoke?
> **Answer:** "We use a dedicated intent classification pipeline (`classifyUserIntent`) operating before task planning. Instead of naïve keyword matching (which previously hijacked research queries mentioning 'TypeScript' into coding tasks), we evaluate the semantic intent, grammatical action verbs, and conjunctions. Queries requesting summaries or explanations are routed strictly to `ResearchSubAgent`, URL queries to `BrowserSubAgent`, code creation requests to `CodingSubAgent`, and multi-clause compound requests to our ACP Swarm Orchestrator."

### Q2: How do you guarantee sandbox security against malicious generated code?
> **Answer:** "We apply defense-in-depth across 4 layers:
> 1. **Path Containment:** Absolute path resolution and realpath checks prevent directory traversal (`../../secret.env`).
> 2. **Static AST Analysis:** The TypeScript compiler parser (`ts.createSourceFile`) validates AST structure before writing to disk.
> 3. **Prohibited Module Whitelisting:** Regex and semantic safety validators reject unauthorized modules like `child_process`, `cluster`, `worker_threads`, `net`, and `process.exit`.
> 4. **Environment Isolation:** Code executed inside the sandbox runs with a stripped environment (`SANDBOX_ENV`) containing only essential OS runtime binaries—zero API keys or environment secrets are accessible."

### Q3: Why does the bot report 'Execution Status: NOT REQUESTED'?
> **Answer:** "In software engineering evaluation, reporting code execution when code was merely generated or saved to disk is a critical false positive. Our system strictly distinguishes between code generation, AST syntax validation, filesystem saving, and sandboxed execution. Execution only occurs when the user explicitly grants permission or requests execution."

### Q4: How is high availability achieved if an LLM provider encounters rate limits?
> **Answer:** "The ModelRouter implements a multi-provider waterfall pattern across Groq and Google Gemini with an automated Circuit Breaker. If a provider returns HTTP 429 (Too Many Requests) or a model is decommissioned, the circuit breaker trips that provider into a 5-minute cooldown and immediately diverts traffic to the secondary provider in less than 1 millisecond without dropping the user's Telegram request."

---

## 5. Summary of Key Files

| File | Purpose in Project |
| :--- | :--- |
| `src/core/intentClassifier.ts` | Disambiguates user prompts into 6 distinct intent categories |
| `src/core/planner.ts` | Decomposes complex compound requests into ACP task dependency graphs |
| `src/agents/SubAgentManager.ts` | Manages concurrent waves of subagent execution |
| `src/agents/workers/ResearchSubAgent.ts` | Synthesizes web intelligence with clean formatting |
| `src/agents/workers/BrowserSubAgent.ts` | Safely fetches web pages with SSRF prevention |
| `src/agents/workers/CodingSubAgent.ts` | Manages code generation, AST checking, and sandbox execution |
| `src/skills/tools.ts` | Sandbox execution engine and security tools |
| `src/memory/manager.ts` | 4-Layer SQLite vector store and knowledge graph engine |
| `src/integrations/telegram.ts` | Telegram Bot adapter with message splitting and clean markdown rendering |
