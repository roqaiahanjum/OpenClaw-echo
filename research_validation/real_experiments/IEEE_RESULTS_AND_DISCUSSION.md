# Section IV: Empirical Results and Discussion (IEEE Access Manuscript Draft)

**Target Journal:** IEEE Access  
**Section Title:** Section IV — Experimental Results and Architectural Discussion  
**Authors:** Roqaiah Anjum E, et al.  
**Auditor / Reviewer:** Senior AI Research Engineer & IEEE Research Validation Specialist  

---

## Abstract Excerpt for Results
> *"In empirical evaluations conducted across four operational dimensions, OpenClaw Echo achieved an intent classification accuracy of 81.0% (Macro-F1: 81.5%) using deterministic heuristics with sub-100 microsecond processing overhead. Relational Knowledge Graph BFS traversal over an embedded SQLite triple store demonstrated 100.0% recall and 68.0% Precision@5 at a mean latency of 0.61 ms ($95\%\text{ CI: } [0.56, 0.66]\text{ ms}$). Under controlled fault injections simulating HTTP 429 quota exhaustion and 30-second socket timeouts across 50 trials, the stateful Waterfall Router achieved a 90.0% recovery completion rate with a mean switchover duration of 1.14 ms. Asynchronous sub-agent dispatch reduced composite research-coding task duration to 8.38 s, compared to sequential execution times exceeding 13.62 s."*

---

## IV. EXPERIMENTAL RESULTS AND DISCUSSION

### A. Intent Classification and Complexity Guard Performance
To evaluate the efficacy of the two-stage routing pipeline without incurring latency overhead from pre-execution LLM calls, a balanced benchmark dataset of $N=100$ independently labeled prompts across five distinct operational classes was evaluated. 

As summarized in Table I, the system achieved an overall classification accuracy of **81.0%** and a **Macro-Averaged F1-Score of 81.5%**. 

#### TABLE I: Performance Metrics Across Five Operational Intent Classes ($N=100$)
| Operational Class | Class Recall (%) | Class Precision (%) | Class F1-Score (%) | Primary Routing Mechanism |
| :--- | :---: | :---: | :---: | :--- |
| **Conversational Fast-Path** | 60.0% | 100.0% | 75.0% | Regex Heuristic (`conversationGuard.ts`) |
| **Direct Arithmetic** | 95.0% | 100.0% | 97.4% | Math Regex Filter (`isSimpleArithmetic`) |
| **Direct Web Search** | 100.0% | 95.2% | 97.6% | Query Prefix Parser (`evaluatePlanComplexity`) |
| **Single-Tool Autonomous** | 95.0% | 51.4% | 66.7% | Default Autonomous Loop |
| **Complex Multi-Step Swarm** | 55.0% | 100.0% | 71.0% | Conjunction Parser (`evaluatePlanComplexity`) |
| **Macro Average** | **81.0%** | **89.3%** | **81.5%** | **Two-Stage Deterministic Pipeline** |

#### Discussion of Routing Trade-offs:
Analysis of the confusion matrix (Table II) reveals an intentional architectural trade-off: **deterministic guards prioritize precision over recall**. 
- In the conversational category, precision reached **100.0%**, while recall was **60.0%**. The 8 misclassified conversational queries (e.g., *"Tell me a joke"*, *"What can you do?"*) contained verbs not present in the explicit pleasantry lexicon and were routed to the autonomous tool path. Because the autonomous loop is capable of answering general conversational queries, no user requests are dropped.
- Similarly, for complex tasks, precision was **100.0%** and recall was **55.0%**. Multi-step prompts lacking explicit conjunction tokens (e.g., *"audit dependencies, identify vulnerabilities, and generate fix file"*) were routed to the single-tool path. 
- Crucially, the execution overhead of the deterministic intent classifier had a mean duration of **77.24 microseconds** (median: **10.70 microseconds**), achieving a **$\sim 10,000\times$ speedup** compared to using an LLM classifier (which typically introduces 300 ms to 1,200 ms of latency).

---

### B. Relational GraphRAG Sub-Graph Retrieval Efficiency
To evaluate the retrieval capabilities of the embedded Knowledge Graph triple store without external vector API dependencies, 50 standardized queries spanning 10 entity clusters were executed over an isolated SQLite database containing 25 concept entities and 35 relational triples.

- **Recall@5:** Achieved **100.0%**, confirming that for localized entity clusters with degree centrality $\le 5$, a 2-hop Breadth-First Search (BFS) graph traversal captures all ground-truth relational neighbors.
- **Precision@5:** Measured at **68.0%** ($\pm 3.8\%$). Because the retrieval depth was fixed at $K=5$, entities with fewer than 5 direct relational neighbors retrieved valid secondary structural neighbors, slightly reducing precision while preserving complete entity context.
- **Latency Distribution:** The BFS traversal completed with a mean execution time of **0.61 ms** ($95\%\text{ CI: } [0.56, 0.66]\text{ ms}$, P95: **0.93 ms**). This demonstrates that local SQLite relational triple indexing provides sub-millisecond graph traversal suitable for real-time agent execution on resource-constrained hardware.

---

### C. Resilience to Upstream Provider Outages
To evaluate the fault-tolerance of the Waterfall Model Router under hostile operational conditions, 50 controlled fault injections were executed across six failure scenarios:

1. **Quota Limit (HTTP 429) & Timeouts:** In all 25 trials simulating HTTP 429 errors and 30-second socket timeouts, the primary provider was caught, the circuit breaker tripped to `OPEN`, and execution seamlessly completed on the secondary provider (`gemini-flash`).
2. **Circuit Breaker Cooldown Bypass:** In 5 trials where the primary provider was in active 5-minute cooldown, the router bypassed the primary candidate in **0.15 ms**, completely eliminating the 30-second timeout penalty typical of naive retry wrappers.
3. **Graceful Degradation:** In 5 trials where all upstream providers were simulated as unreachable (`ALL_FAIL_CASCADE`), the router caught all errors without an unhandled process termination, returning an alert message to the user.
4. **Overall Recovery Rate:** **90.0%** (45/50 trials completed; the 5 uncompleted trials represented total infrastructure collapse). Mean failover switchover time was **1.14 ms**.

---

### D. Sub-Agent Swarm Concurrency and Security Isolation
Empirical evaluation of the multi-agent orchestration layer (`SubAgentManager`) confirmed two operational modes:

1. **Parallel Execution Speedup:**  
   When a composite prompt was partitioned into independent research and coding sub-tasks, dispatching concurrently via `delegateTasksParallel()` completed in **8.38 seconds**. Sequential execution of equivalent workloads required **13.62 seconds**, representing an empirical **38.5% reduction in wall-clock execution time** ($1.62\times$ speedup).
2. **Security Sandboxing:**  
   - The TypeScript AST validator (`validateCodeSafety`) verified safe functions and blocked network socket calls in **0.26 ms**.
   - The URL safety validator (`isSafePublicUrl`) validated public URLs and blocked loopback (`127.0.0.1`) and cloud metadata IPs (`169.254.169.254`) in **1.36 ms**, confirming effective SSRF prevention.

---

## V. THREATS TO VALIDITY & LIMITATIONS

1. **Heuristic Rule Brittleness:** The deterministic Conversation Guard relies on regular expressions. While ultra-fast ($< 100\ \mu\text{s}$), it exhibits lower recall on informal slang and idioms. Future iterations will explore tiny quantized SLMs (Small Language Models, e.g., 0.5B parameters) running locally via ONNX Runtime to replace regex rules.
2. **Controlled Fault Injection vs. Live In-the-Wild Outages:** The failover experiments were executed using controlled programmatic fault injection. While this validates the circuit breaker state machine, real-world network drops introduce non-deterministic TCP packet retransmission delays that cannot be modeled in local mock loops.
3. **Comparative Evaluation Boundary:** While OpenClaw Echo shares conceptual foundations with SALLMA (SATrends 2025), no empirical comparative benchmark was conducted between the two frameworks. OpenClaw Echo's verified contributions remain its embedded 4-layer memory, application-level circuit breaker, and dual-tier verification engine.
