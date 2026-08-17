// @ts-nocheck
import dotenv from 'dotenv';
import path from 'path';

// Load .env with absolute path — works from any working directory
dotenv.config({ 
  path: path.resolve(__dirname, '../../.env')
});

// Fallback: also try current directory
if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

// ✅ Fix for Railway deployment
if (typeof File === "undefined") {
    const { File } = require("buffer");
    global.File = File;
}

/**
 * OpenClaw Echo: Safe Bootstrap Entry Point
 * Ensures environment variables are valid before the rest of the app loads.
 */
async function bootstrap() {
    console.log("-----------------------------------------");
    console.log("    🚀 OPENCLAW ECHO: ACTIVATE 🚀        ");
    console.log("-----------------------------------------");

    console.log('[Startup] Environment Check:');
    console.log('  GOOGLE_API_KEY:', (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY) ? '✅ Loaded' : '❌ MISSING');
    console.log('  GROQ_API_KEY:  ', (process.env.GROQ_API_KEY || process.env.GROQ_KEY) ? '✅ Loaded' : '⚠️  Missing (fallback unavailable)');
    console.log('  TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN ? '✅ Loaded' : '❌ MISSING');
    console.log('  TAVILY_API_KEY:', process.env.TAVILY_API_KEY ? '✅ Loaded' : '⚠️  Missing (web search disabled)');
    console.log('  SMTP_USER:     ', process.env.SMTP_USER ? '✅ Loaded' : '⚠️  Missing (email disabled)');

    const hasGoogleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
    const hasTelegramToken = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    const missingEnv: string[] = [];
    if (!hasGoogleKey) missingEnv.push("GOOGLE_API_KEY");
    if (!hasTelegramToken) missingEnv.push("TELEGRAM_TOKEN");

    if (missingEnv.length > 0) {
        console.error(`[Fatal] Critical environment variables missing: ${missingEnv.join(", ")}`);
        process.exit(1);
    }

    try {
        console.log("[System] Environment verified. Loading services...");
        const { startServer, stopServer } = await import("./integrations/telegram");
        const server = await startServer();
        console.log("[System] System Online - Railway Deployment Ready");

        let isShuttingDown = false;
        const handleShutdown = async (signal: string) => {
            if (isShuttingDown) return;
            isShuttingDown = true;
            console.log(`\n[System] Signal ${signal} received. Stopping server and releasing ports...`);
            try {
                await stopServer(server);
            } catch (e: any) {
                console.error("[System] Error during server shutdown:", e.message);
            }
            process.exit(0);
        };

        process.on("SIGINT", () => handleShutdown("SIGINT"));
        process.on("SIGTERM", () => handleShutdown("SIGTERM"));
        process.on("SIGHUP", () => handleShutdown("SIGHUP"));

        process.on("uncaughtException", (err) => {
            console.error("[Panic] Uncaught Exception:", err);
            setTimeout(() => process.exit(1), 1000);
        });

        process.on("unhandledRejection", (reason, promise) => {
            console.error("[Panic] Unhandled Rejection at:", promise, "reason:", reason);
        });

    } catch (error) {
        console.error("[Fatal] Failed to bootstrap OpenClaw Echo:", error);
        process.exit(1);
    }
}

bootstrap();
