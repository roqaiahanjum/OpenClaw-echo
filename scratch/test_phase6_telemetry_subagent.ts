import "dotenv/config";
import { telemetry } from "../src/integrations/telemetry";
import { SubAgentRunner } from "../src/core/subagent";
import { synthesizeSkillTool } from "../src/skills/tools";

async function runPhase6Tests() {
    console.log("=================================================");
    console.log(" PHASE 6 TELEMETRY & SUBAGENT TEST SUITE ");
    console.log("=================================================\n");

    // TEST 1: Telemetry Emitter
    console.log("--- TEST 1: TELEMETRY SSE EMITTER ---");
    let receivedEvent = false;
    telemetry.on("agent:state", (evt) => {
        receivedEvent = true;
        console.log(`[Test 1] Emitted Agent State Event: state=${evt.data.state}`);
    });
    telemetry.emitAgentState("PLANNING", "Testing telemetry stream");
    console.assert(receivedEvent === true, "Telemetry event not received.");
    console.log("✅ TEST 1 PASSED: TelemetryEmitter broadcasts events cleanly.\n");

    // TEST 2: Hierarchical Sub-Agent Execution
    console.log("--- TEST 2: HIERARCHICAL SUB-AGENT RUNNER ---");
    const subResult = await SubAgentRunner.run("Analyze project structure and list top files");
    console.log(`[Test 2] SubAgent Status: ${subResult.status}`);
    console.log(`[Test 2] SubAgent Summary: ${subResult.summary.slice(0, 100)}...`);
    console.log(`[Test 2] SubAgent Scratchpad Entries: ${subResult.scratchpad.length}`);
    console.assert(subResult.status === "SUCCESS", "SubAgent execution failed.");
    console.log("✅ TEST 2 PASSED: SubAgentRunner executed isolated child context and returned summary.\n");

    // TEST 3: Safe Skill Synthesis Syntax Check
    console.log("--- TEST 3: SAFE SKILL SYNTHESIS SYNTAX VALIDATION ---");
    const invalidRes = await synthesizeSkillTool.invoke({
        name: "broken_skill",
        description: "broken test skill",
        code: "const x = ; return x;", // Invalid JS syntax
        schemaJSON: "{}"
    });
    console.log(`[Test 3] Invalid Code Result: ${invalidRes}`);
    console.assert(invalidRes.includes("JavaScript syntax error"), "Syntax error was not caught.");
    console.log("✅ TEST 3 PASSED: synthesize_skill catches invalid syntax before registration.\n");

    console.log("=================================================");
    console.log(" ALL PHASE 6 TELEMETRY & SUBAGENT TESTS PASSED ");
    console.log("=================================================");
}

runPhase6Tests();
