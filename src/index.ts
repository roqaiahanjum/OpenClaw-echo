// @ts-nocheck
import "dotenv/config"; // 1. Immediate environment loading (prevents hoisting issues)

/**
 * OpenClaw Echo: Safe Bootstrap Entry Point
 * Ensures environment variables are valid before the rest of the app loads.
 */
async function bootstrap() {
    console.log("-----------------------------------------");
    console.log("    🚀 OPENCLAW ECHO: ACTIVATE 🚀        ");
    console.log("-----------------------------------------");

    // 2. Critical Key Handshake
    const requiredEnv = ["TELEGRAM_TOKEN", "GOOGLE_API_KEY"];
    const missingEnv = requiredEnv.filter(key => !process.env[key]);

    if (missingEnv.length > 0) {
        console.error(`[Fatal] Critical environment variables missing: ${missingEnv.join(", ")}`);
        console.error("[Fatal] Please check your .env file and restart the bot.");
        process.exit(1);
    }

    try {
        // 3. Dynamic Import: Loads the Telegram integration ONLY after environment is ready.
        // This solves constructor 'replace' errors and race conditions.
        console.log("[System] Environment verified. Loading services...");
        const { startServer, stopServer } = await import("./integrations/telegram");
        const server = await startServer();

        // 4. Graceful Shutdown Configuration
        const handleShutdown = async () => {
            await stopServer(server);
            process.exit(0);
        };

        process.on("SIGINT", handleShutdown);
        process.on("SIGTERM", handleShutdown);

    } catch (error) {
        console.error("[Fatal] Failed to bootstrap OpenClaw Echo:", error);
        process.exit(1);
    }
}

// Start the sequence
bootstrap();
