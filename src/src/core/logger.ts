import { Telemetry } from "./telemetry";

/**
 * Simple in-memory logger for the Diagnostic Dashboard.
 * Keeps the last 50 logs for live viewing.
 */
export class DashboardLogger {
    private static logs: { time: string, message: string }[] = [];
    private static MAX_LOGS = 50;

    static log(message: string) {
        const time = new Date().toLocaleTimeString();
        const logEntry = { time, message };
        this.logs.unshift(logEntry);
        
        if (this.logs.length > this.MAX_LOGS) {
            this.logs.pop();
        }
        
        // Also print to console
        console.log(`[${time}] ${message}`);

        // Broadcast to Dashboard immediately via SSE
        Telemetry.broadcast("log", logEntry);
    }

    static getLogs() {
        return this.logs;
    }
}
