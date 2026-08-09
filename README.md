<div align="center">
  
# 🤖 OpenClaw Echo

**An Enterprise-Grade Autonomous AI Agent with Hybrid Memory and Network Self-Healing.**

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlebard&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)

</div>

---

## 📖 Overview
**OpenClaw Echo** is a production-ready, local-first autonomous AI agent framework accessible via Telegram. Designed to handle complex, multi-step tasks, it features a dynamic sub-agent delegation system, persistent multi-hop memory, and a fault-tolerant network router that ensures zero-downtime operations.

## ✨ Core Features

| Capability | Description |
| :--- | :--- |
| **Sub-Agent Framework** | Parallel task execution using specialized workers (`Research Agent`, `Coding Agent`, `Browser Agent`). |
| **5-Layer Hybrid Memory** | Deep context retention combining SQLite facts, Vector RAG embeddings, and 2-hop GraphRAG traversals. |
| **Waterfall Failover Router** | Auto-healing network architecture. If Google Gemini API times out, the system instantly reroutes to Groq (Llama 3) with zero user disruption. |
| **Pre-Flight Shield** | Automated environment verification script that prevents port conflicts and validates API keys before server boot. |
| **Strict Data Constraints** | Enforced JSON output formatting and complex multi-agent synthesis capabilities. |

## 🏗️ System Architecture

1. **User Interface:** Telegram Bot API (Long-Polling)
2. **Orchestrator:** Main Agent with Agent Communication Protocol (ACP)
3. **Execution Layer:** Parallel Sub-Agents (`Promise.all` async execution)
4. **Cognitive Routing:** ModelRouter (Gemini-2.5-Flash → Groq Llama-3.1-8B)
5. **Storage:** SQLite Relational Graph + Semantic Vectors

---

## 🚀 Quick Start Guide

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed. You will also need API keys for Telegram (via BotFather), Google AI Studio, and Groq.

### 2. Installation
Clone the repository and install the required dependencies:
```bash
git clone https://github.com/roqaiahanjum/OpenClaw-echo.git
cd OpenClaw-echo
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory and securely add your credentials:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
```

### 4. Boot the System
Run the development server. The **Pre-Flight Shield** will automatically verify your environment before starting the agent:
```bash
npm run dev
```

---

## 🧪 Testing the Agent Live
Once online, open your Telegram bot and try these stress-test prompts:
* **The Coding Test:** `"Write a TypeScript function to reverse a string and explain it."`
* **The Synthesis Test:** `"Fetch the Wikipedia page for 'Turing Machine', summarize it, and write a Python script simulating its tape."`
* **The Chaos Test:** *(Temporarily invalidate your Gemini Key and watch Groq instantly catch the fallback without crashing!)*

---

## 🎓 Academic Context
This software was engineered as a final-year Computer Science and Engineering (CSE) academic project at **Ghousia College of Engineering** (Visvesvaraya Technological University).

* **Project Team:** Roqaiah Anjum E, Mokshitha N, Ambika
* **Project Guide:** Syeda Misba
* **Department:** Computer Science and Engineering (CSE)

<div align="center">
  <i>Built with precision. Engineered for resilience.</i>
</div>