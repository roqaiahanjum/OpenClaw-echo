import { Response } from "express";

/**
 * Telemetry: Real-Time SSE Engine
 * Broadcasts live events to dashboard clients.
 */
export class Telemetry {
    private static clients: Response[] = [];

    /**
     * Add a new Server-Sent Events stream client.
     */
    static subscribe(res: Response) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders(); // Establish the connection immediately

        this.clients.push(res);

        res.on("close", () => {
            this.clients = this.clients.filter(client => client !== res);
            res.end();
        });

        // Send an initial handshake
        this.broadcast("system", { message: "SSE Telemetry connected." });
    }

    /**
     * Broadcast an event and payload to all connected dashboard windows.
     */
    static broadcast(event: string, data: any) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        this.clients.forEach(client => {
            try {
                client.write(payload);
            } catch (err) {
                // Remove closed clients implicitly if write fails
                this.clients = this.clients.filter(c => c !== client);
            }
        });
    }
}
