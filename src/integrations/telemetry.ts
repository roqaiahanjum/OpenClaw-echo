import { EventEmitter } from "events";
import { Request, Response } from "express";

export type AgentState = "IDLE" | "PLANNING" | "EXECUTING" | "VERIFYING" | "RECOVERING";

export interface TelemetryEvent {
    type: "agent:state" | "tool:call" | "tool:result" | "memory:access" | "system:log";
    timestamp: string;
    data: any;
}

export class TelemetryEmitter extends EventEmitter {
    private static instance: TelemetryEmitter;
    private clients: Response[] = [];
    private executionStats = {
        totalToolsExecuted: 0,
        successfulTools: 0,
        failedTools: 0,
        totalExecutionTimeMs: 0
    };

    private constructor() {
        super();
    }

    public static getInstance(): TelemetryEmitter {
        if (!TelemetryEmitter.instance) {
            TelemetryEmitter.instance = new TelemetryEmitter();
        }
        return TelemetryEmitter.instance;
    }

    public handleSSEStream(req: Request, res: Response) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();

        this.clients.push(res);
        console.log(`[Telemetry] Dashboard client connected to SSE stream. Total clients: ${this.clients.length}`);

        // Initial handshake payload
        const initEvent: TelemetryEvent = {
            type: "system:log",
            timestamp: new Date().toISOString(),
            data: { message: "Connected to OpenClaw Echo Telemetry SSE Engine." }
        };
        res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

        req.on("close", () => {
            this.clients = this.clients.filter(c => c !== res);
            console.log(`[Telemetry] Client disconnected. Active clients: ${this.clients.length}`);
        });
    }

    public emitTelemetry(type: TelemetryEvent["type"], data: any) {
        const event: TelemetryEvent = {
            type,
            timestamp: new Date().toISOString(),
            data
        };

        if (type === "tool:result") {
            this.executionStats.totalToolsExecuted++;
            if (data.status === "PASS" || data.status === "SUCCESS") {
                this.executionStats.successfulTools++;
            } else {
                this.executionStats.failedTools++;
            }
            if (data.executionTimeMs) {
                this.executionStats.totalExecutionTimeMs += data.executionTimeMs;
            }
        }

        this.emit(type, event);

        const payload = `data: ${JSON.stringify(event)}\n\n`;
        this.clients.forEach(client => {
            try {
                client.write(payload);
            } catch (err) {
                this.clients = this.clients.filter(c => c !== client);
            }
        });
    }

    public emitAgentState(state: AgentState, details?: string) {
        this.emitTelemetry("agent:state", { state, details });
    }

    public emitToolCall(toolName: string, args: any) {
        this.emitTelemetry("tool:call", { toolName, args });
    }

    public emitToolResult(toolName: string, status: string, executionTimeMs: number, result?: any) {
        this.emitTelemetry("tool:result", { toolName, status, executionTimeMs, result });
    }

    public emitMemoryAccess(layer: string, query: string, itemsCount: number) {
        this.emitTelemetry("memory:access", { layer, query, itemsCount });
    }

    public emitSystemLog(message: string, level: string = "INFO") {
        this.emitTelemetry("system:log", { message, level });
    }

    public getExecutionStats() {
        return { ...this.executionStats };
    }
}

export const telemetry = TelemetryEmitter.getInstance();
