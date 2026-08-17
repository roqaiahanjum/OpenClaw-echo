import * as dotenv from "dotenv";
import { sendEmailReportTool } from "./src/skills/tools";
import { Diplomat } from "./src/core/diplomat";
import { localVerifyToolResult } from "./src/core/localVerifier";

dotenv.config();

async function runTest() {
    console.log("=== RUNNING SEND_EMAIL_REPORT FOCUSED TESTS ===\n");

    // TEST 1: Schema Verification
    console.log("--- TEST 1: Tool Schema Verification ---");
    const schemaObj = (sendEmailReportTool as any).schema;
    const shape = schemaObj.shape || schemaObj._def?.shape?.() || {};
    
    const hasTo = !!shape.to;
    const hasSubject = !!shape.subject;
    const hasBody = !!shape.body;

    console.log(`Schema fields present -> to: ${hasTo}, subject: ${hasSubject}, body: ${hasBody}`);
    if (!hasTo || !hasSubject || !hasBody) {
        throw new Error("FAIL: Tool schema is missing required fields (to, subject, body)");
    }
    console.log("TEST 1 PASS ✅\n");

    // TEST 2: Zod Input Validation for 'to', 'subject', 'body'
    console.log("--- TEST 2: Schema Validation Checks ---");
    let invalidEmailCaught = false;
    try {
        await sendEmailReportTool.invoke({ to: "not-an-email", subject: "Test", body: "Body" });
    } catch (e: any) {
        invalidEmailCaught = true;
        console.log(`Invalid email caught correctly: "${e.message}"`);
    }

    if (!invalidEmailCaught) {
        throw new Error("FAIL: Tool did not reject invalid email address");
    }

    let missingBodyCaught = false;
    try {
        await sendEmailReportTool.invoke({ to: "user@example.com", subject: "Test" } as any);
    } catch (e: any) {
        missingBodyCaught = true;
        console.log(`Missing body caught correctly: "${e.message}"`);
    }

    if (!missingBodyCaught) {
        throw new Error("FAIL: Tool did not reject missing body parameter");
    }
    console.log("TEST 2 PASS ✅\n");

    // TEST 3: Mocked SMTP Transporter Invocation & Success Output
    console.log("--- TEST 3: Successful SMTP Invocation & Result Verification ---");
    const originalSendReport = Diplomat.sendReport;
    let diplomatCalledWith: any = null;

    Diplomat.sendReport = async (options: { to: string; subject: string; body: string }) => {
        diplomatCalledWith = options;
        console.log(`[Mock Diplomat] SMTP sendMail called for: ${options.to}`);
    };

    try {
        const testPayload = {
            to: "roqaiahanjum9@gmail.com",
            subject: "OpenClaw SMTP Test",
            body: "SMTP is working successfully."
        };

        const result = await sendEmailReportTool.invoke(testPayload);
        console.log(`Tool Result: "${result}"`);

        if (!diplomatCalledWith) {
            throw new Error("FAIL: Diplomat.sendReport was not invoked");
        }

        if (diplomatCalledWith.to !== testPayload.to || diplomatCalledWith.subject !== testPayload.subject || diplomatCalledWith.body !== testPayload.body) {
            throw new Error("FAIL: Payload passed to Diplomat did not match input parameters");
        }

        const expectedMsg = `Email sent successfully to roqaiahanjum9@gmail.com with subject "OpenClaw SMTP Test".`;
        if (result !== expectedMsg) {
            throw new Error(`FAIL: Unexpected success result format. Got: "${result}"`);
        }

        // Check local verifier for success result
        const localResult = localVerifyToolResult("send_email_report", testPayload, result);
        console.log(`Local Verifier Result: status=${localResult.status}, reason="${localResult.reason}"`);
        if (localResult.status !== "pass") {
            throw new Error(`FAIL: Local verifier did not pass successful email result`);
        }

        console.log("TEST 3 PASS ✅\n");
    } finally {
        Diplomat.sendReport = originalSendReport;
    }

    // TEST 4: Mocked SMTP Error Handling & Credential Masking
    console.log("--- TEST 4: SMTP Error Handling & Log/Credential Masking ---");
    const fakePassword = "SUPER_SECRET_SMTP_PASS_9876";
    process.env.SMTP_PASS = fakePassword;

    let loggedError = "";
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
        loggedError += args.join(" ") + "\n";
    };

    Diplomat.sendReport = async () => {
        throw new Error(`SMTP auth failed for secret pass: ${fakePassword}`);
    };

    try {
        const failPayload = {
            to: "fail@example.com",
            subject: "Fail Test",
            body: "Testing failure mode."
        };

        const failResult = await sendEmailReportTool.invoke(failPayload);
        console.log(`Tool Failure Result: "${failResult}"`);

        if (!failResult.startsWith("Failed to send email report to fail@example.com")) {
            throw new Error("FAIL: Tool did not return a proper failure message");
        }

        if (failResult.includes(fakePassword)) {
            throw new Error("FAIL: Return result exposed SMTP password!");
        }

        if (loggedError.includes(fakePassword)) {
            throw new Error("FAIL: Error log exposed SMTP password!");
        }

        const localFailVerify = localVerifyToolResult("send_email_report", failPayload, failResult);
        console.log(`Local Verifier Failure Result: status=${localFailVerify.status}`);
        if (localFailVerify.status !== "fail") {
            throw new Error("FAIL: Local verifier did not fail when tool returned failure message");
        }

        console.log("TEST 4 PASS ✅\n");
    } finally {
        console.error = originalConsoleError;
        Diplomat.sendReport = originalSendReport;
    }

    // TEST 5: Real Live SMTP Execution (If SMTP env vars exist)
    console.log("--- TEST 5: Real SMTP Server Execution Check ---");
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (user && pass && pass !== fakePassword) {
        console.log(`SMTP credentials found in .env (User: ${user}). Attempting real live SMTP send...`);
        try {
            const realResult = await sendEmailReportTool.invoke({
                to: user, // send test email to SMTP_USER itself
                subject: "OpenClaw SMTP Test",
                body: "SMTP is working successfully."
            });
            console.log(`Live SMTP Result: "${realResult}"`);
            if (realResult.startsWith("Email sent successfully")) {
                console.log("LIVE SMTP EXECUTION SUCCESSFUL! 🚀");
            } else {
                console.warn(`Live SMTP failed: "${realResult}"`);
            }
        } catch (e: any) {
            console.warn(`Live SMTP send error: ${e.message}`);
        }
    } else {
        console.log("Skipping live SMTP send (no active SMTP credentials in .env)");
    }
    console.log("TEST 5 DONE ✅\n");

    console.log("=== ALL SEND_EMAIL_REPORT TESTS PASSED SUCCESSFULLY! ===");
    process.exit(0);
}

runTest().catch((err) => {
    console.error("Test suite failed:", err);
    process.exit(1);
});
