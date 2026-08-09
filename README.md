# OpenClaw Echo 🤖
An autonomous, multi-agent AI system with hybrid memory and network self-healing, accessible via Telegram.

## 🌟 Core Architecture
* **Sub-Agent Delegation:** Parallel processing using specialized workers (`Research`, `Coding`, and `Browser`).
* **Hybrid 5-Layer Memory:** Integrates SQLite, Vector RAG, and dynamic GraphRAG multi-hop retrieval.
* **Zero-Downtime Failover Router:** Waterfall fallback routing between Google Gemini and Groq (Llama 3/Mixtral) to bypass LLM timeouts.
* **Pre-Flight Shield:** Automated environment verification to prevent port conflicts and API failures before boot.

## 🚀 Quick Start
1. **Clone the repository:**
   ```bash
   git clone https://github.com/roqaiahanjum/OpenClaw-echo.git
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Environment Setup:**
   Create a `.env` file in the root directory and add your keys:
   ```env
   TELEGRAM_BOT_TOKEN=your_token
   GEMINI_API_KEY=your_gemini_key
   GROQ_API_KEY=your_groq_key
   ```
4. **Run the Pre-Flight Check & Start:**
   ```bash
   npm run dev
   ```

## 🎓 Academic Context
Developed as a final-year Computer Science and Engineering (CSE) project at Ghousia College of Engineering.
* **Project Team:** Roqaiah Anjum E, Mokshitha N, Ambika
* **Project Guide:** Syeda Misba