# 🤖 OpenClaw Echo
### A Production-Ready, Self-Evolving, Autonomous AI Agent Framework

---

## 🚀 Overview
**OpenClaw Echo** is a massively capable, self-orchestrating AI layer. Unlike standard reactive chatbots, Echo exists as an independent entity capable of maintaining persistent memory, scheduling its own background tasks, and pushing updates to its own version control.

## 🏗️ Project Structure
Understanding the directory layout of the OpenClaw ecosystem:

```text
open-claw-project/
├── src/
│   ├── core/           # The Brain: Swarm logic and Model Routing (Gemini/Ollama)
│   ├── memory/         # The Vault: Semantic memory and Vector storage
│   ├── skills/         # The Tools: Custom tools for the agent (Web search, Git ops)
│   ├── integrations/   # The Bridge: Telegram Bot and Webhook logic
│   └── types/          # The Blueprint: TypeScript interfaces and definitions
├── dashboard/          # The Command Center: Frontend React/Next.js monitoring
├── scripts/            # Utility scripts for database migration and setup
├── .env                # Environment variables (API Keys - DO NOT PUSH)
├── package.json        # Dependencies and build scripts
└── tsconfig.json       # TypeScript configuration
---

### **2. How to "Force" your Folders to Appear**
If you update the README but the **`src/`** or **`dashboard/`** folders still don't show up at the top of GitHub, it's because Git is ignoring them (likely due to a `.gitignore` file or they were never "indexed").

**Run this exact "Nuclear" sequence to fix it:**

1. **Delete any accidental sub-git folders (CRITICAL):**
   Sometimes if you download a template, it has its own `.git` folder inside it. Run this:
   ```powershell
   Remove-Item -Recurse -Force .git
   git init
   git remote add origin https://github.com/roqaiahanjum/OpenClaw.git