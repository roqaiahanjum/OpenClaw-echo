import * as fs from "fs";
import * as path from "path";
import { 
    createSaltedHash, 
    verifyAccessCode, 
    AuthRateLimiter, 
    AuthManager 
} from "../auth";

describe("OpenClaw Echo: Demo Access Code Authentication", () => {
    const testDbPath = path.resolve(process.cwd(), "scratch", "test_jest_auth.db");
    const testSecret = "DemoKey2026!Protected";
    let saltedHash: string;

    beforeAll(() => {
        if (fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (_) {}
        }
        saltedHash = createSaltedHash(testSecret);
    });

    afterAll(() => {
        if (fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (_) {}
        }
    });

    describe("1. Cryptographic Salted PBKDF2 Hash Engine", () => {
        it("should generate a valid salt:hash formatted string", () => {
            expect(saltedHash).toContain(":");
            const [salt, hash] = saltedHash.split(":");
            expect(salt.length).toBe(32); // 16 bytes hex
            expect(hash.length).toBe(128); // 64 bytes SHA-512 hex
        });

        it("should verify correct access codes and reject whitespace padding", () => {
            expect(verifyAccessCode(testSecret, saltedHash)).toBe(true);
            expect(verifyAccessCode(`   ${testSecret}   `, saltedHash)).toBe(true);
        });

        it("should reject incorrect or empty access codes", () => {
            expect(verifyAccessCode("WrongPassword", saltedHash)).toBe(false);
            expect(verifyAccessCode("", saltedHash)).toBe(false);
        });

        it("should handle corrupted hashes without crashing", () => {
            expect(verifyAccessCode(testSecret, "invalid-hash-string")).toBe(false);
        });
    });

    describe("2. Rate Limiting & Lockout Protection", () => {
        it("should enforce lockout after 5 consecutive failures", () => {
            const limiter = new AuthRateLimiter(5, 60000);
            const user = "victim_user_123";

            expect(limiter.check(user).locked).toBe(false);

            for (let i = 1; i <= 4; i++) {
                const res = limiter.recordFailure(user);
                expect(res.locked).toBe(false);
                expect(res.remainingAttempts).toBe(5 - i);
            }

            const fifth = limiter.recordFailure(user);
            expect(fifth.locked).toBe(true);
            expect(fifth.remainingAttempts).toBe(0);
            expect(limiter.check(user).locked).toBe(true);

            limiter.reset(user);
            expect(limiter.check(user).locked).toBe(false);
        });
    });

    describe("3. SQLite Persistence & Authorization Lifecycle", () => {
        let auth: AuthManager;

        beforeEach(async () => {
            if (fs.existsSync(testDbPath)) {
                try { fs.unlinkSync(testDbPath); } catch (_) {}
            }
            process.env.DEMO_ACCESS_CODE_HASH = saltedHash;
            process.env.ADMIN_TELEGRAM_ID = "admin_root_1";
            AuthManager.resetInstance();
            auth = AuthManager.getInstance(testDbPath);
            await auth.init();
        });

        afterEach(async () => {
            await auth.close();
            AuthManager.resetInstance();
            if (fs.existsSync(testDbPath)) {
                try { fs.unlinkSync(testDbPath); } catch (_) {}
            }
        });

        it("should block unauthenticated users and authorize admins by default", () => {
            expect(auth.isUserAuthorized("random_user_99")).toBe(false);
            expect(auth.isUserAuthorized("admin_root_1")).toBe(true);
        });

        it("should reject invalid access codes during verifyAndAuthorize", async () => {
            const res = await auth.verifyAndAuthorize("candidate_user_1", "BadCode");
            expect(res.success).toBe(false);
            expect(res.error).toBe("INVALID_CODE");
            expect(auth.isUserAuthorized("candidate_user_1")).toBe(false);
        });

        it("should authenticate valid code and persist to SQLite", async () => {
            const res = await auth.verifyAndAuthorize("candidate_user_1", testSecret, {
                username: "student_alex",
                firstName: "Alex"
            });
            expect(res.success).toBe(true);
            expect(auth.isUserAuthorized("candidate_user_1")).toBe(true);

            const users = await auth.listAuthorizedUsers();
            expect(users.length).toBe(1);
            expect(users[0].user_id).toBe("candidate_user_1");
            expect(users[0].username).toBe("student_alex");
            expect(users[0].status).toBe("active");
        });

        it("should allow administrators to revoke authorized users", async () => {
            await auth.authorizeUser("candidate_user_2");
            expect(auth.isUserAuthorized("candidate_user_2")).toBe(true);

            const revoked = await auth.revokeUser("candidate_user_2");
            expect(revoked).toBe(true);
            expect(auth.isUserAuthorized("candidate_user_2")).toBe(false);

            const active = await auth.listAuthorizedUsers();
            expect(active.length).toBe(0);
        });
    });
});
