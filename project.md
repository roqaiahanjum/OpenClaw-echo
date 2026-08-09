# OpenClaw Echo: Judge Interview Prep

This document contains 30 questions categorized by difficulty that a judge or technical reviewer might ask about the **OpenClaw Echo** project.

---

## 🟢 Easy Questions (Basic Understanding & Features)

1.  **What is OpenClaw Echo in simple terms?**
    *   It is an autonomous AI agent framework that operates primarily through Telegram, capable of memory, scheduling tasks, and executing tools independently.

2.  **Which primary messaging platform does the bot integrate with?**
    *   Telegram, using the `telegraf` library.

3.  **What are the two main AI models used in the Hybrid Intelligence layer?**
    *   Google Gemini 2.0 Flash (Cloud) and Ollama (Local/Edge).

4.  **What command would a user type to check if the system is healthy?**
    *   `/status`.

5.  **How can a user clear the bot's short-term memory?**
    *   By using the `/clear` command.

6.  **What is the "Clockwork Scheduler"?**
    *   An autonomous background engine that allows the agent to schedule and run tasks (like research or audits) at specific intervals.

7.  **What is the purpose of the Vite-based dashboard on Port 3005?**
    *   It provides real-time telemetry, internal chat, and system monitoring (Glassmorphism Console).

8.  **What does the "Sentinel Middleware" do?**
    *   It handles security and resource management, such as validating API quotas and pruning context buffers.

9.  **What technology is used for the Admin Panel on Port 8501?**
    *   Python and Streamlit.

10. **How do you start the project locally using Node.js?**
    *   `npm install` followed by `npm run dev`.

---

## 🟡 Medium Questions (Architecture & Implementation)

11. **Explain the "6-Step Neural Flow" mentioned in the documentation.**
    *   It follows: Ingest (input) → Synthesis (context) → Routing (model selection) → Devolve (sub-agent logic) → Execution (tool use) → Persistence (saving to memory).

12. **How does the system handle "Context Window" limitations?**
    *   The `MemoryManager` retrieves relevant history, and the system automatically trims context (e.g., to 500 characters) to ensure speed and stay within token limits.

13. **What is the "Swarm" strategy in OpenClaw Echo?**
    *   It uses specialized sub-agent personas (Researcher, Engineer, Architect, Synthesis) to break down and solve complex multi-part tasks.

14. **How does the `ModelRouter` decide between Gemini and Ollama?**
    *   It uses a logic-based routing system. It can fail over to Ollama if Gemini hits rate limits or if the task requires local edge processing.

15. **What are the two types of databases used for memory, and what are their roles?**
    *   **SQLite3**: Used for recent conversation history and structured metadata.
    *   **JSON-based Vector Core**: Used for long-term semantic retrieval (RAG).

16. **How does the system handle multi-part tasks that require multiple tool calls?**
    *   The `executeAutonomousFlow` uses a `while` loop with a maximum number of iterations (e.g., 3) to process tool calls until a final response is generated.

17. **What happens if the Google Gemini API returns a 429 (Rate Limit) error?**
    *   The system detects the error, waits for a short period (e.g., 2 seconds), and retries the flow once before potentially failing or switching logic.

18. **Why is OpenClaw Echo considered "Self-Evolving"?**
    *   It can analyze its own codebase using the `ProjectAnalyzer`, ingest documentation into its memory, and (conceptually) push updates to Git.

19. **How is the project optimized for cloud deployment platforms like Railway?**
    *   It includes logic to handle Railway-specific environment variables, port binding, and a unified entry point that serves both the API and the frontend.

20. **What is the role of the `SkillRegistry`?**
    *   It serves as a central hub for all tools (skills) the agent can use, allowing the LLM to discover and invoke functions like web scraping or file writing.

---

## 🔴 Hard Questions (Edge Cases, Security & Performance)

21. **Describe the failover logic in the `ModelRouter`. What specific triggers cause a switch from Cloud to Local?**
    *   Triggers include API timeouts, 429 errors (quota/rate limits), or specific "logic modes" where local execution is preferred for privacy or cost.

22. **How do you prevent the autonomous loop from getting stuck in an infinite tool-calling cycle?**
    *   By implementing a `MAX_ITERATIONS` guard (currently set to 3) in the `executeAutonomousFlow` and monitoring for repetitive tool outputs.

23. **How does the RAG (Retrieval-Augmented Generation) system balance between "Recency" and "Relevancy"?**
    *   It queries the Vector Core for semantic matches while always prepending the most recent SQLite history to the prompt to maintain conversational flow.

24. **In the `telegram.ts` file, how is "Deep Maintenance" implemented?**
    *   It triggers an optimization of the memory layer and re-ingests files from the `src/sandbox` into the semantic core to refresh the agent's knowledge.

25. **How does the system ensure security when executing code or scripts generated by the LLM?**
    *   Executions are isolated within a dedicated `src/sandbox` directory, and the Sentinel Middleware monitors for potentially harmful commands or toxic output.

26. **Explain the `Clockwork` scheduler's integration with the `executeAutonomousFlow`. How does it maintain state?**
    *   Clockwork runs as a background singleton. When a task triggers, it sends the prompt through the same 6-step flow as a user message, marking its source as `CLOCKWORK_SCHEDULER`.

27. **What are the trade-offs of using a JSON-based Vector Core instead of a specialized vector database like Pinecone or Weaviate?**
    *   **Pros**: Zero external dependency, local-first, easy to debug/edit.
    *   **Cons**: Slower search performance on very large datasets compared to indexed C++ implementations.

28. **How does the system handle large file uploads or long messages on Telegram?**
    *   It uses a `splitMessage` utility to chunk long responses into 4000-character segments (Telegram's limit) and can process images by converting them to Base64 for the Gemini Vision API.

29. **If you were to scale this to 10,000 concurrent users, what would be the primary bottleneck?**
    *   The single-threaded nature of Node.js for the flow engine and the SQLite lock contention. One would need to move to a distributed worker model (Redis/RabbitMQ) and a more robust DB (PostgreSQL).

30. **How does the `ProjectAnalyzer` calculate the "System Audit Score"?**
    *   It evaluates metrics like dependency health, environment variable presence, sandbox cleanliness, and memory optimization status to generate a diagnostic report.
