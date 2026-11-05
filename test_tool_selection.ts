import { ToolSelector } from './src/core/toolSelector';

const t1 = ToolSelector.selectTools("Run this JavaScript: console.log(2+2)");
console.log("T1 Category:", t1.category);
console.log("T1 Tools:", t1.tools.map(t => t.name));
const hasWrite = t1.tools.some(t => t.name === "write_sandbox_file");
const hasRun = t1.tools.some(t => t.name === "run_sandbox_code");
console.log("T1 Has write_sandbox_file:", hasWrite, "Has run_sandbox_code:", hasRun);

const t2 = ToolSelector.selectTools("Add a goal: finish testing");
console.log("T2 Category:", t2.category);
console.log("T2 Tools:", t2.tools.map(t => t.name));
const hasGoal2 = t2.tools.some(t => t.name === "manage_project_goals");
console.log("T2 Has manage_project_goals:", hasGoal2);

const t3 = ToolSelector.selectTools("What are my goals?");
console.log("T3 Category:", t3.category);
console.log("T3 Tools:", t3.tools.map(t => t.name));
const hasGoal3 = t3.tools.some(t => t.name === "manage_project_goals");
console.log("T3 Has manage_project_goals:", hasGoal3);

if (hasWrite && hasRun && hasGoal2 && hasGoal3) {
  console.log("ALL TOOL SELECTION CHECKS PASSED!");
  process.exit(0);
} else {
  console.error("TOOL SELECTION CHECKS FAILED!");
  process.exit(1);
}
