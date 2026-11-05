# OpenClaw Echo — Production Release Checklist & Operational Runbook
**Release Candidate:** v1.0.0-rc1  
**Target Branch:** `feature/turso-persistent-memory`  
**Deploy Destination:** Render Web Service (`https://openclaw-echo.onrender.com`)  
**Gate Status:** **PASSED — READY FOR COMMIT & PUSH**

---

## 1. Pre-Deployment Release Gate Verification

All release gate criteria must be checked and signed off before committing or pushing to the production repository:

- [x] **1. Static Code Analysis & Type Safety**
  - Command: `npx tsc --noEmit`
  - Result: 0 errors, 0 warnings.
  - Sign-off: PASS.

- [x] **2. Unit Test Suite**
  - Command: `npm test`
  - Result: 2 test suites passed, 10/10 tests passed (6.5s).
  - Coverage: Telegram webhook handling, error sanitization, fail-closed auth.
  - Sign-off: PASS.

- [x] **3. Security & Multi-Tenant Isolation Regression Suite**
  - Command: `npx ts-node --transpile-only test_security_isolation_regression.ts`
  - Result: 8/8 tests passed (100%).
  - Coverage: Layer 1, 2, 3, 4 memory isolation, stale vector purging, coding tool parameter normalization (`fileName` & `filename`), CodingSubAgent E2E sandbox execution.
  - Sign-off: PASS.

- [x] **4. Full Production Build Packaging**
  - Command: `npm run build`
  - Result: Exit code 0. Vite bundled client dashboard (1,789 modules in 1.71s), server compiled cleanly to `dist/`.
  - Sign-off: PASS.

- [x] **5. Git Working Tree Integrity**
  - Only intended files modified:
    - `src/agents/workers/ConversationSubAgent.ts`
    - `src/memory/manager.ts`
    - `src/skills/tools.ts`
  - No secret keys, test databases, or credentials staged.
  - Sign-off: PASS.

---

## 2. Commit & Push Instructions (Awaiting Final User Approval)

> [!IMPORTANT]
> Do NOT force-push or rewrite Git history. Use normal commit and push sequence.

```bash
# 1. Stage the hardened source files
git add src/agents/workers/ConversationSubAgent.ts src/memory/manager.ts src/skills/tools.ts

# 2. Commit with descriptive semantic message
git commit -m "fix(security): enforce 4-layer tenant isolation, stale vector purging, and coding tool normalization"

# 3. Push normally to the feature branch
git push origin feature/turso-persistent-memory
```

---

## 3. Post-Deployment Production Verification Runbook

Once Render automatically detects the push and finishes the deployment:

### Step 1: Confirm Active Commit on Render
Verify Render dashboard reports deployment of the new commit hash.

### Step 2: Query Readiness & Subsystem Health Endpoints
Execute HTTP health probe against live Render service:
```bash
# Verify HTTP 200 and healthy database connection
curl -i https://openclaw-echo.onrender.com/readyz

# Verify skills, vector count, and webhook mode
curl -i https://openclaw-echo.onrender.com/api/status
```
Expected response:
- `status`: `"ready"`
- `database`: `"connected"`
- `mode`: `"webhook"`

### Step 3: Verify Telegram Webhook Registration
Inspect Telegram webhook status safely:
```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo"
```
Verify:
- `url`: `https://openclaw-echo.onrender.com/api/telegram-webhook`
- `has_custom_certificate`: `false`
- `pending_update_count`: 0 (or low)
- `last_error_message`: empty or dated prior to current fix.

### Step 4: Live Three-Turn Multi-User Verification
Send real test messages via Telegram to verify both contextual intelligence and tenant boundaries:

1. **Turn 1 (Concept Explanation):**
   - User prompt: *"Can you explain what zero-knowledge proofs are in simple words?"*
   - Expected behavior: Clear, conversational explanation without invoking Tavily web search.
2. **Turn 2 (Follow-Up with Example):**
   - User prompt: *"Can you give me an example using colors?"*
   - Expected behavior: Retains zero-knowledge proof topic and explains the two-color ball/cave analogy. Does not search dictionary.
3. **Turn 3 (Fact Storage & Isolation):**
   - User prompt: *"Remember that my favorite cryptographer is Shafi Goldwasser."*
   - Expected behavior: Saves preference to tenant memory. Verifiable zero leakage to other chat IDs.

### Step 5: Production Log Sanitization Audit
Inspect Render production logs:
- Confirm no Telegram bot tokens appear in logs or setWebhook URLs.
- Confirm only `bot[REDACTED_BOT_TOKEN]` appears in any webhook registration or error messages.

---

## 4. Rollback Plan

If Render deployment encounters unexpected issues:
1. Revert to previous stable commit `51f5af0`:
   ```bash
   git revert HEAD --no-edit
   git push origin feature/turso-persistent-memory
   ```
2. Verify `/readyz` returns HTTP 200 within 60 seconds of redeploy.
3. Database migrations (`ALTER TABLE summaries ADD COLUMN chat_id`) are non-destructive and backward-compatible with `51f5af0`.

