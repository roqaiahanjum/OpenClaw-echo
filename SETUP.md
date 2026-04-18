# OpenClaw Echo: Setup Guide (Updated)

Follow these steps to synchronize your local environment with the OpenClaw Echo framework.

## 1. Prerequisites
- **Node.js**: v18 or higher.
- **Gemini API Key**: Obtain from Google AI Studio.
- **Telegram Bot Token**: Obtain from @BotFather.

## 2. Directory Structure
Ensure you have the following directories (if not, the system will attempt to create them):
- `src/sandbox/`: For autonomous file storage.
- `src/skills/dynamic/`: For synthesized agent skills.
- `src/memory/`: For persistent vector storage.

## 3. Environment Configuration
Create a `.env` file in the root directory:
```env
GOOGLE_API_KEY=your_key
TELEGRAM_TOKEN=your_token
TELEGRAM_MODE=polling # Set to 'webhook' for production
PORT=3005
```

## 4. Launch Instructions
**Development Mode**:
```bash
npm run dev
```

**Production Build**:
```bash
npm run build
npm start
```

## 5. Deployment (Webhook Mode)
If using `webhook` mode:
1. Expose Port 3005 via `ngrok`: `ngrok http 3005`.
2. Add `TELEGRAM_WEBHOOK_URL=https://your-ngrok-url.io` to your `.env`.
3. Restart the server.

## 6. Verification
- Access `http://localhost:3005` to view the Diagnostic Dashboard.
- Message your bot on Telegram: `/status` to verify system health.
