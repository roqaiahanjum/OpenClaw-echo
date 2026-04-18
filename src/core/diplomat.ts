import * as nodemailer from "nodemailer";

/**
 * Diplomat: Autonomous Email Communication Engine
 * Sends rich HTML email reports to external stakeholders.
 */
export class Diplomat {
    private static createTransporter() {
        const host = process.env.SMTP_HOST || "smtp.gmail.com";
        const port = parseInt(process.env.SMTP_PORT || "587");
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        if (!user || !pass) {
            throw new Error("SMTP credentials not configured. Set SMTP_USER and SMTP_PASS in .env");
        }

        return nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass }
        });
    }

    static async sendReport(options: {
        to: string;
        subject: string;
        body: string;
        agentName?: string;
    }): Promise<void> {
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

        await transporter.sendMail({
            from: `"${agentName}" <${from}>`,
            to: options.to,
            subject: options.subject,
            html: htmlBody,
            text: options.body
        });

        console.log(`[Diplomat] Email report sent to: ${options.to}`);
    }
}
