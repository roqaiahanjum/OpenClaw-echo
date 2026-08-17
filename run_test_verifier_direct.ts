import { verifyStepResult } from "./src/core/verifier";
import * as dotenv from "dotenv";

dotenv.config();

async function testVerifier() {
    console.log("Testing verifyStepResult directly to prove scope fix...");
    const userGoal = "Create a file named test_scope.txt and then read it";
    const actionName = "write_sandbox_file";
    const output = "Successfully created file test_scope.txt with content.";
    
    console.log(`User Goal: ${userGoal}`);
    console.log(`Action: ${actionName}`);
    console.log(`Output: ${output}`);
    
    const result = await verifyStepResult(userGoal, actionName, output);
    console.log("Verification Result:", result);
}

testVerifier().then(() => process.exit(0));
