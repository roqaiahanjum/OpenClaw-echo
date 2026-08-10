<div align="center">
  
# 🤖 OpenClaw Echo

**A resilient, local-first autonomous AI agent framework with Hybrid Memory, Sub-Agent Swarms, and Network Self-Healing.**

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlebard&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)

</div>

---

## 📖 What is OpenClaw Echo?

**OpenClaw Echo** is a production-ready AI agent framework built in TypeScript, accessible natively through a Telegram Bot interface. It is designed to handle multi-step reasoning tasks by distributing workloads across specialized sub-agents, while maintaining deep context through a multi-layered hybrid memory system.

### The Problem it Solves
Traditional LLM wrappers suffer from isolated conversations, context window exhaustion, and sudden crashes when API quotas are hit. OpenClaw Echo solves this by introducing **semantic memory retention** and a **Waterfall Failover Router**. If your primary AI provider (Google Gemini) times out or hits a rate limit, the system instantly and silently routes the request to a fallback provider (Groq) without dropping the user's conversation.

---

## ✨ Key Implemented Capabilities

- **Sub-Agent Framework:** Parallel task execution through specialized workers. The `SubAgentManager` delegates tasks to dedicated `Research Agent`, `Coding Agent`, and `Browser Agent` workers.
- **Multi-Layer Hybrid Memory:** Deep context retention using a multi-tiered architecture:
  - **SQLite Relational Facts:** Extracts and deduplicates user profile data, project info, and preferences into `openclaw.db`.
  - **Conversation & Summaries:** Tracks recent interactions and periodically summarizes them to save tokens.
  - **Vector Semantic Search:** Uses LangChain's MemoryVectorStore and Google Embeddings to map and retrieve knowledge from a persistent JSON-backed semantic core.
- **Waterfall Failover Router:** A highly resilient circuit-breaker model. Queries attempt `Gemini 2.5 Flash` first. If it fails (timeout, 429 quota), it gracefully degrades to `Groq Llama 3.1 8B` or `Mixtral`, ensuring 100% uptime.
- **Fast-Path Execution:** An intent classifier detects simple queries (e.g., greetings) or direct search requests (e.g., "latest news"), bypassing the heavy planning layer and saving processing time.
- **Telegram Native UI:** Complete integration with Telegraf for a smooth, conversational user interface.
- **Pre-Flight Shield:** Verifies critical environment variables and connections on boot.

---

## 🏗️ System Architecture

Requests flow through the Telegram Polling Interface, hit the Intent Classifier, and either take a Fast Path or get routed to the Sub-Agent Manager for complex planning. Memory is dynamically pulled and stored at every step.

```mermaid
graph TD
    User((User)) -->|Telegram Message| TP[Telegram Polling Interface]
    TP --> Classifier{Intent Classifier}
    
    Classifier -->|Simple Chat / Search| FastPath[Fast-Path Engine]
    Classifier -->|Complex Task| SAM[Sub-Agent Manager]
    
    subgraph Parallel Execution Layer
        SAM -->|Delegates| RA[Research Agent]
        SAM -->|Delegates| CA[Coding Agent]
        SAM -->|Delegates| BA[Browser Agent]
    end
    
    subgraph Hybrid Memory Core
        RA -.->|Fact Extraction / Retrieval| DB[(SQLite Relational DB)]
        CA -.->|Semantic Search| VS[(Vector Embeddings)]
        FastPath -.-> DB
    end
    
    subgraph Waterfall Failover Router
        RA --> MR[Model Router]
        CA --> MR
        FastPath --> MR
        MR -->|Primary Route| API1[Google Gemini API]
        MR -->|Fallback Route| API2[Groq Llama 3 / Mixtral]
    end
    
    MR -->|Synthesized Output| TP
```

---

## 🛠️ Technology Stack

| Category | Technologies Used |
| :--- | :--- |
| **Language & Runtime** | Node.js (v20+), TypeScript |
| **Orchestration** | LangChain Core & Community |
| **AI Providers** | Google Generative AI (`gemini-2.5-flash`), Groq SDK (`llama-3.1-8b`) |
| **Database & Memory** | SQLite3 (`openclaw.db`), LangChain VectorStore |
| **User Interface** | Telegram Bot API (`telegraf`), Express.js |

---

## 📂 Project Structure

```text
open-claw-echo/
├── src/
│   ├── agents/          # Specialized sub-agents (Coding, Research, Browser)
│   ├── core/            # Core routing, planners, intent classifiers, and failover
│   ├── integrations/    # Telegram bot and Express webhooks
│   ├── memory/          # Hybrid SQLite + Vector memory managers
│   └── skills/          # Custom tool registries (Web search, execution, etc.)
├── dashboard/           # Front-end administration (Build artifacts)
├── openclaw.db          # Local SQLite relational memory
├── semantic_core.json   # Local serialized vector embeddings
└── package.json
```

---

## 🚀 Installation & Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v20 or higher)
- Telegram Bot Token (from [@BotFather](https://t.me/botfather) on Telegram)
- [Google AI Studio API Key](https://aistudio.google.com/) (Required)
- [Groq API Key](https://console.groq.com/) (Optional, highly recommended for failover)

### 2. Clone and Install
```bash
git clone https://github.com/roqaiahanjum/OpenClaw-echo.git
cd OpenClaw-echo
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory based on the provided `.env.example`:

```env
# Critical (Required)
TELEGRAM_TOKEN=your_telegram_bot_token_here
GOOGLE_API_KEY=your_gemini_api_key_here

# Fallback / Features (Optional but Recommended)
GROQ_API_KEY=your_groq_api_key_here
PORT=3005
```

### 4. Boot the Agent
Run the development environment. The **Pre-Flight Shield** will verify your keys before engaging the Telegram polling engine.

```bash
npm run dev
```

*(To run the production-optimized build, use `npm run start`)*

---

## 🧪 Testing the Agent

Open your Telegram bot and try these prompts to test the specific subsystems:

1. **Test Hybrid Memory:**
   - `"My name is Alice and I am a 4th year CSE student."`
   - *(Wait for response)*
   - `"What year of college am I in?"` *(The agent will pull this from SQLite)*
2. **Test Fast-Path / Direct Search:**
   - `"Look up the latest news on AI."` *(Bypasses the planner for instant results)*
3. **Test Waterfall Failover (Chaos Test):**
   - Temporarily change your `.env` `GOOGLE_API_KEY` to an invalid string.
   - Restart the server and ask a question.
   - *Result: The circuit breaker trips and seamlessly routes your request to Groq without crashing.*

---

## 🚧 Current Limitations & Future Roadmap

**Currently Implemented:**
- ✅ Sub-agent delegation for multi-step prompts.
- ✅ Hybrid Memory deduplication and persistence.
- ✅ Automatic AI provider failover.
- ✅ Telegram-native integration.

**Future Roadmap (Not Yet Implemented):**
- ⏳ **Local-Only LLM Mode:** Full integration with Ollama to run models completely offline without cloud APIs.
- ⏳ **Advanced GraphRAG:** While foundational graph structures exist, full multi-hop traversal is planned for the next release.
- ⏳ **Continuous Autonomous Mode:** Allowing the agent to run background cron jobs or continuous research loops without user prompting.

---
<div align="center">
  <i>Built with precision. Engineered for resilience.</i>
</div>