import { runMasterHarness } from "./eval_harness";

if (require.main === module) {
    runMasterHarness()
        .then(() => {
            console.log("\n[RunEval] Evaluation completed successfully.");
            process.exit(0);
        })
        .catch(err => {
            console.error("\n[RunEval] Evaluation failed with error:", err);
            process.exit(1);
        });
}
