import * as nodemailer from "nodemailer";

export type SmtpOutcome =
    | "TOOL_NOT_INVOKED"
    | "CONNECTION_FAILED"
    | "AUTH_FAILED"
    | "SERVER_REJECTED"
    | "SERVER_ACCEPTED_DELIVERY_UNCONFIRMED"
    | "DELIVERY_CONFIRMED";

export interface SendReportResult {
    success: boolean;
    outcome: SmtpOutcome;
    accepted: string[];
    rejected: string[];
    messageId?: string;
    details?: string;
    error?: string;
}

/**
 * Diplomat: Autonomous Email Communication Engine
 * Sends rich HTML email reports to external stakeholders.
 */
export class Diplomat {
    public static createTransporter() {
        const host = process.env.SMTP_HOST || "smtp.gmail.com";
        const port = parseInt(process.env.SMTP_PORT || "587", 10);
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        if (!user || !pass) {
            throw new Error("SMTP credentials not configured. Set SMTP_USER and SMTP_PASS in .env");
        }

        // Google App Passwords are 16 characters often formatted with spaces: 'xxxx xxxx xxxx xxxx'.
        // Strip any accidental whitespace or wrapping quotes from the password string.
        const cleanPass = pass.replace(/\s+/g, "").replace(/^['"]|['"]$/g, "");

        // If port is 587 (STARTTLS), connect via standard SMTP options with timeouts
        // Render Free Tier blocks port 25, while port 587 requires STARTTLS.
        const baseOptions: nodemailer.TransportOptions = {
            host,
            port,
            secure: port === 465,
            auth: { user, pass: cleanPass },
            connectionTimeout: 10000, // 10s timeout to fail fast on blocked outbound ports
            greetingTimeout: 10000,
            socketTimeout: 15000,
            tls: {
                rejectUnauthorized: true
            }
        } as any;

        if (host.includes("gmail") && port === 465) {
            return nodemailer.createTransport({
                service: "gmail",
                auth: { user, pass: cleanPass },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 15000
            } as any);
        }

        return nodemailer.createTransport(baseOptions);
    }

    static async sendReport(options: {
        to: string;
        subject: string;
        body: string;
        agentName?: string;
    }): Promise<SendReportResult> {
        const target = (options.to || "").trim();
        // RFC 5322 standard recipient email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(target)) {
            return {
                success: false,
                outcome: "SERVER_REJECTED",
                accepted: [],
                rejected: [target],
                error: `Invalid recipient email address format: '${target}'`
            };
        }

        const transporter = this.createTransporter();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const agentName = options.agentName || "OpenClaw Echo";

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"/>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 640px; margin: 32px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
        .header { background: linear-gradient(135deg, #0ea5e9, #818cf8); padding: 32px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; color: white; letter-spacing: 2px; }
        .header p { margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; }
        .body { padding: 32px; }
        .body pre { background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; word-break: break-word; color: #94a3b8; }
        .footer { padding: 16px 32px; text-align: center; font-size: 11px; color: #475569; border-top: 1px solid rgba(255,255,255,0.05); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${agentName.toUpperCase()}</h1>
            <p>Autonomous Intelligence Report</p>
        </div>
        <div class="body">
            <pre>${options.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
        <div class="footer">
            Generated autonomously by ${agentName} · ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

        try {
            const info = await transporter.sendMail({
                from: `"${agentName}" <${from}>`,
                to: target,
                subject: options.subject,
                html: htmlBody,
                text: options.body
            });

            const accepted = Array.isArray(info?.accepted) ? info.accepted.map(String) : [];
            const rejected = Array.isArray(info?.rejected) ? info.rejected.map(String) : [];
            const isAccepted = accepted.some(addr => addr.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(addr.toLowerCase()));

            console.log(`[Diplomat] Email report send attempt to: ${target}. Accepted: ${accepted.join(",")}, Rejected: ${rejected.join(",")}`);

            if (isAccepted) {
                return {
                    success: true,
                    outcome: "SERVER_ACCEPTED_DELIVERY_UNCONFIRMED",
                    accepted,
                    rejected,
                    messageId: info?.messageId,
                    details: `SMTP server accepted message for onward relay to ${target} (Message-ID: ${info?.messageId || "generated"}). Note: SMTP protocol confirms relay acceptance; inbox delivery is unconfirmed.`
                };
            }

            return {
                success: false,
                outcome: "SERVER_REJECTED",
                accepted,
                rejected: rejected.length > 0 ? rejected : [target],
                details: `Recipient ${target} was not accepted by SMTP relay server.`
            };
        } catch (sendErr: any) {
            const code = (sendErr.code || "").toUpperCase();
            const rawMsg = sendErr.message || String(sendErr);

            let outcome: SmtpOutcome = "SERVER_REJECTED";
            if (code === "EAUTH" || sendErr.responseCode === 535) {
                outcome = "AUTH_FAILED";
            } else if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || rawMsg.includes("timeout")) {
                outcome = "CONNECTION_FAILED";
            }

            return {
                success: false,
                outcome,
                accepted: [],
                rejected: [target],
                error: rawMsg
            };
        }
    }
}
