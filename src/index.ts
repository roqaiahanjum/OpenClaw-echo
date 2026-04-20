// @ts-nocheck
import "dotenv/config";

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

    const requiredEnv = ["TELEGRAM_TOKEN", "GOOGLE_API_KEY"];
    const missingEnv = requiredEnv.filter(key => !process.env[key]);

    if (missingEnv.length > 0) {
        console.error(`[Fatal] Critical environment variables missing: ${missingEnv.join(", ")}`);
        process.exit(1);
    }

    try {
        console.log("[System] Environment verified. Loading services...");
        const { startServer, stopServer } = await import("./integrations/telegram");
        const server = await startServer();
        console.log("[System] System Online - Railway Deployment Ready");

        const handleShutdown = async () => {
            await stopServer(server);
            process.exit(0);
        };

        process.on("SIGINT", handleShutdown);
        process.on("SIGTERM", handleShutdown);

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
