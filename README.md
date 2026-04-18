<div align="center">
  <h1>🤖 OpenClaw Echo</h1>
  <p><b>A Production-Ready, Self-Evolving, Autonomous AI Agent Framework on Telegram</b></p>

  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)]()
  [![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)]()
  [![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)]()
  [![Telegram API](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)]()
  [![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?style=for-the-badge&logo=chainlink&logoColor=white)]()
  [![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=llama&logoColor=white)]()
</div>

<br>

## 📖 Short Description

**OpenClaw Echo** is a massively capable, self-orchestrating AI layer and Telegram bot. Unlike standard reactive chatbots, Echo exists as an independent entity capable of maintaining persistent memory, scheduling its own background tasks, analyzing massive codebases, synthesizing data into charts, and automatically pushing updates to its own version control. It runs on a hybrid intelligence model, dynamically failing over between the blazing-fast Google Gemini and local Ollama edge nodes.

---

## ✨ Features List

* **Hybrid Intelligence (`ModelRouter`)**: Seamlessly routes between Google Gemini (Cloud API v1beta) and Ollama (Local Edge). Includes smart retry logic for API limits.
* **Autonomous 6-Step Neural Flow**: Extracts context, trims history, invokes intelligence, executes tools, replies, and persists data entirely autonomously.
* **The Swarm (Delegation Strategy)**: Spawns asynchronous sub-agents (`Researcher`, `Coder`, `Analyst`, `Writer`, `QA_Engineer`) to execute gigantic monolithic tasks in parallel.
* **Persistent Memory & Vector RAG**: Maintains a rolling SQLite history and a serverless JSON Vector Core for long-term semantic retrieval.
* **Dynamic Skill Registry**: Features 18+ registered autonomous tools including Deep Web Scraping, SMTP Email Dispatch, Git version control, and Sandbox Code Execution.
* **Real-time Telemetry Dashboard**: A breathtaking web dashboard powered by Express.js and Server-Sent Events (SSE) that pushes 0-latency logs and health maps.
* **Polling & Webhook Support**: Flexible Telegram integration capable of running via fast-polling or standard webhooks, automatically handling Telegram's 4096-character limits via smart message chunking.

---

## 🛠️ Tech Stack

* **Core Runtime:** Node.js, TypeScript
* **AI Orchestration:** LangChain, Google Generative AI SDK `@google/generative-ai`
* **Local Inference:** Ollama 
* **Database / Memory:** SQLite3 (`sqlite3`), Chroma/JSON Vector Core
* **Web & Dashboard:** Express.js, Server-Sent Events (SSE), Mermaid.js
* **Integrations:** `node-telegram-bot-api`, `simple-git`, `nodemailer`, `cheerio`

---

## 🏗️ Project Structure

```text
open-claw-echo/
├── src/
│   ├── core/           # The Brain: Swarm logic, Model Routing, Timers, Goals
│   ├── memory/         # The Vault: Semantic memory, SQLite manager, RAG
│   ├── skills/         # The Tools: Custom tools (Web search, Git ops, File parsing)
│   ├── integrations/   # The Bridge: Telegram Bot, Express API, Dashboard SSE
│   ├── sandbox/        # Isolated folder for safe execution of AI-generated node apps
│   └── index.ts        # Bootstrap, graceful shutdown (SIGINT/SIGTERM), Port cleanup
├── scratch/            # Temporary diagnostic testing scripts
├── docker-compose.yml  # Production Docker stack (Agent + Ollama sidecar)
├── Dockerfile          # Production container setup
├── openclaw.db         # Persistent SQLite database (auto-generated)
├── package.json        # Dependencies and build scripts
└── .env                # Environment variables (API Keys and Config)
```

---

## 💻 Installation Steps

### Option A: Bare Metal (Node.js)

1. **Clone the repository**
   ```bash
   git clone https://github.com/roqaiahanjum/openclaw-echo.git
   cd openclaw-echo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env and supply your GOOGLE_API_KEY and TELEGRAM_TOKEN
   ```

4. **Boot Agent & Telemetry Server**
   ```bash
   npm start
   ```

### Option B: Containerized (Docker Compose)
*Highly recommended for maximum sandbox isolation.*

1. **Start the Echo stack in detached mode**
   ```bash
   docker-compose up -d --build
   ```

2. **Pull the local fallback model (First time only)**
   ```bash
   docker exec openclaw-ollama ollama pull llama3
   ```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory.

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GOOGLE_API_KEY` | ✅ | Google Gemini API key |
| `TELEGRAM_TOKEN` | ✅ | Telegram Bot token from @BotFather |
| `OLLAMA_BASE_URL` | ❌ | Ollama endpoint (default: `http://localhost:11434` / `http://ollama:11434`) |
| `OLLAMA_MODEL` | ❌ | Local model name (default: `llama3`) |
| `PORT` | ❌ | Dashboard port (default: `3005`) |
| `SMTP_HOST` | ❌ | SMTP server for email dispatch (`setup for notification agent`) |
| `SMTP_PORT` | ❌ | SMTP port (default: `587`) |
| `SMTP_USER` | ❌ | SMTP username |
| `SMTP_PASS` | ❌ | SMTP app password |

---

## 🚀 How to Run

```bash
# Starts the prestart port-cleaner, then launches the TS Node server
npm start

# OR via Docker:
docker-compose up
```
Once booted, the agent checks the environment. By default, it will start completely autonomously in **Polling Mode** and connect directly to your Telegram bot. Concurrently, it exposes the command-center REST API.

---

## 📱 How to Use on Telegram

1. Open Telegram and search for your bot username (the one you created with `@BotFather`).
2. Click **Start** or send `/status`.
3. Talk to it naturally! 
   - *"Research the latest AI news and summarize it."*
   - *"Check your sandbox directory and write a python script that prints 'Hello'."*
   - *"Delegate a task to the QA_Engineer to review my code."*
4. Long responses exceeding the 4096-character limit will be intelligently and automatically chunked!

---

## 📡 Live Telemetry Command Center

Once booted, point your browser to **[http://localhost:3005](http://localhost:3005)** to enter the Live Diagnostic Hub.
There you can view the neural connectivity graph, run sentinel system audits, monitor live LLM reasoning logs, and interact dynamically via the web-bot interface.

### 🖼️ Screenshots
> *(Placeholder for UI Screenshots)*
> 
> *Screenshot 1: The Live Telemetry Command Center Dashboard*
> *Screenshot 2: Telegram Swarm Delegation deeply interacting with the code*
> *Screenshot 3: Terminal View showing zero-latency API failovers*

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

<br>

<div align="center">
<i>"Intelligence is not just knowledge, but the autonomy to apply it safely across the open layer."</i>
</div>