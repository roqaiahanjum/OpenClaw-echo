import * as readline from "readline";
import { createSaltedHash, verifyAccessCode } from "../src/core/auth";

/**
 * OpenClaw Echo — Safe Demo Access Code Hash Generator
 *
 * Supports:
 * 1. Direct argument: npm run auth:generate-hash -- "YourCode"
 * 2. Interactive masked prompt with visual '*' feedback.
 */
async function getAccessCode(): Promise<string> {
    // 1. If an argument was explicitly provided, use it directly
    if (process.argv[2]) {
        return process.argv[2].trim();
    }

    // 2. Interactive terminal prompt with visual asterisk '*' feedback
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        let input = "";

        if (stdin.isTTY && typeof stdin.setRawMode === "function") {
            stdout.write("Enter your desired demo access code: ");
            try {
                stdin.setRawMode(true);
                stdin.resume();
                stdin.setEncoding("utf8");

                const onData = (char: string) => {
                    if (char === "\n" || char === "\r" || char === "\u0004") {
                        stdin.removeListener("data", onData);
                        try { stdin.setRawMode(false); } catch {}
                        stdout.write("\n");
                        resolve(input.trim());
                    } else if (char === "\u0003") { // Ctrl+C
                        stdin.removeListener("data", onData);
                        try { stdin.setRawMode(false); } catch {}
                        stdout.write("\nAborted.\n");
                        process.exit(1);
                    } else if (char === "\b" || char === "\x7f") { // Backspace
                        if (input.length > 0) {
                            input = input.slice(0, -1);
                            stdout.write("\b \b");
                        }
                    } else {
                        input += char;
                        stdout.write("*");
                    }
                };

                stdin.on("data", onData);
                return;
            } catch {
                // Fall back to standard readline if rawMode fails
            }
        }

        // Standard fallback prompt
        const rl = readline.createInterface({ input: stdin, output: stdout });
        rl.question("Enter your desired demo access code: ", (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    try {
        const code = await getAccessCode();

        if (!code || code.length < 4) {
            console.error("\n❌ Error: Access code must be at least 4 characters long.");
            process.exit(1);
        }

        // Generate salted PBKDF2 hash using existing createSaltedHash
        const saltedHash = createSaltedHash(code);

        // Verify compatibility with existing verification logic
        const isValid = verifyAccessCode(code, saltedHash);
        if (!isValid) {
            console.error("\n❌ Fatal Error: Hash verification check failed. Do not use this hash.");
            process.exit(1);
        }

        console.log("\n========================================================================");
        console.log("   🔐 OpenClaw Echo — Demo Access Code Hash Generated Successfully    ");
        console.log("========================================================================\n");
        console.log("Algorithm:        PBKDF2-HMAC-SHA512 (100,000 iterations, 16-byte random salt)");
        console.log("Self-Verify:      ✅ PASSED\n");
        console.log("Copy and paste the following line into your Render Environment Variables:\n");
        console.log(`DEMO_ACCESS_CODE_HASH=${saltedHash}\n`);
        console.log("------------------------------------------------------------------------");
        console.log("⚠️  Security Note:");
        console.log("   - Your plaintext access code was NOT saved or logged anywhere.");
        console.log("   - Only share the plaintext code with authorized demo evaluators.");
        console.log("   - Enter the generated DEMO_ACCESS_CODE_HASH value in the Render dashboard.");
        console.log("========================================================================\n");

    } catch (err: any) {
        console.error("\n❌ Unexpected error generating access code hash:", err.message);
        process.exit(1);
    }
}

main();
