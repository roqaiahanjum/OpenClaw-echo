# OpenClaw Echo — Statistical Validation Tests & Verification Scripts
**Purpose:** Independent Verification of Numerical Claims from Raw CSV Records  
**Applicable Standards:** IEEE Access Reproducibility Guidelines  
**Status:** FULLY REPRODUCIBLE  

---

## 1. Overview of Verification Scripts

This document provides standalone verification scripts in both **TypeScript / Node.js** and **Python** to recompute all statistical figures reported in the manuscript directly from the raw experimental CSV files located in `research_validation/final_verified_experiments/`.

Neither script depends on internal project libraries; they read only standard CSV files using built-in or standard mathematical routines.

---

## 2. Standalone Node.js Verification Script (`verify_statistics.ts`)

```typescript
import * as fs from "fs";
import * as path from "path";

// 1. Wilson Score Interval Calculator
function wilsonInterval(k: number, n: number, z = 1.95996): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - halfWidth), Math.min(1, center + halfWidth)];
}

// 2. Non-Parametric Bootstrap Percentile Calculator
function bootstrapCI(data: number[], iterations = 2000, alpha = 0.05): [number, number] {
  const means: number[] = [];
  const n = data.length;
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      sum += data[idx];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const low = means[Math.floor(iterations * (alpha / 2))];
  const high = means[Math.floor(iterations * (1 - alpha / 2))];
  return [low, high];
}

const dir = path.join(__dirname);

// TEST 1: Recompute Intent Classification Accuracy & Wilson CI
const intentLines = fs.readFileSync(path.join(dir, "FINAL_INTENT_RESULTS.csv"), "utf8").trim().split("\n").slice(1);
const totalPrompts = intentLines.length;
const correctPrompts = intentLines.filter(l => l.split(",")[4] === "true").length;
const accuracy = correctPrompts / totalPrompts;
const [accLow, accHigh] = wilsonInterval(correctPrompts, totalPrompts);

console.log(`[VERIFY: Intent Accuracy] ${correctPrompts}/${totalPrompts} = ${(accuracy * 100).toFixed(1)}% | 95% Wilson CI: [${(accLow * 100).toFixed(1)}%, ${(accHigh * 100).toFixed(1)}%]`);

// TEST 2: Recompute GraphRAG Retrieval Precision & Recall Invariants
const retLines = fs.readFileSync(path.join(dir, "FINAL_RETRIEVAL_RESULTS.csv"), "utf8").trim().split("\n").slice(1);
let invariantViolations = 0;
let totalTP = 0;
let totalRet = 0;
let totalGT = 0;

for (const line of retLines) {
  const cols = line.split(",");
  const gt = parseInt(cols[3], 10);
  const ret = parseInt(cols[4], 10);
  const tp = parseInt(cols[5], 10);
  const rec = parseFloat(cols[8]);

  if (tp > gt && gt > 0) invariantViolations++;
  if (rec > 1.0) invariantViolations++;
  totalTP += tp;
  totalRet += ret;
  totalGT += gt;
}

console.log(`[VERIFY: GraphRAG Invariants] Invariant Violations: ${invariantViolations} (Must be 0)`);
console.log(`[VERIFY: GraphRAG Sums] Total TP: ${totalTP}, Total Retrieved Top-5: ${totalRet}, Total Relevant: ${totalGT}`);

// TEST 3: Paired Concurrency Differences
const concLines = fs.readFileSync(path.join(dir, "PARALLEL_VS_SEQUENTIAL_RESULTS.csv"), "utf8").trim().split("\n").slice(1);
const seqDurations: number[] = [];
const parDurations: number[] = [];
const diffs: number[] = [];

for (const line of concLines) {
  const cols = line.split(",");
  const s = parseFloat(cols[2]);
  const p = parseFloat(cols[3]);
  seqDurations.push(s);
  parDurations.push(p);
  diffs.push(s - p);
}

const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
const [diffLow, diffHigh] = bootstrapCI(diffs);
console.log(`[VERIFY: Paired Concurrency] Mean Paired Diff: ${meanDiff.toFixed(2)} ms | 95% Bootstrap CI: [${diffLow.toFixed(2)} ms, ${diffHigh.toFixed(2)} ms]`);
```

---

## 3. Standalone Python Verification Script (`verify_statistics.py`)

```python
import csv
import math
import numpy as np

def wilson_interval(k, n, z=1.95996):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + (z**2) / n
    center = (p + (z**2) / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p)) / n + (z**2) / (4 * n**2))) / denom
    return (max(0.0, center - half), min(1.0, center + half))

def bootstrap_ci(data, iters=2000, alpha=0.05):
    arr = np.array(data)
    boot_means = [np.mean(np.random.choice(arr, size=len(arr), replace=True)) for _ in range(iters)]
    return (np.percentile(boot_means, 100 * (alpha / 2)), np.percentile(boot_means, 100 * (1 - alpha / 2)))

# 1. Intent Validation
with open("FINAL_INTENT_RESULTS.csv", mode="r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    intent_rows = list(reader)

correct = sum(1 for r in intent_rows if r["is_match"].lower() == "true")
total = len(intent_rows)
ci_low, ci_high = wilson_interval(correct, total)
print(f"Intent Accuracy: {correct}/{total} = {correct/total*100:.1f}% (Wilson 95% CI: [{ci_low*100:.1f}%, {ci_high*100:.1f}%])")

# 2. Retrieval Invariant Check
with open("FINAL_RETRIEVAL_RESULTS.csv", mode="r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    ret_rows = list(reader)

violations = 0
for r in ret_rows:
    tp = int(r["true_positives"])
    gt = int(r["ground_truth_count"])
    rec = float(r["recall_at_5"])
    prec = float(r["precision_at_5_fixed"])
    if tp > gt and gt > 0:
        violations += 1
    if rec > 1.0 or prec > 1.0:
        violations += 1

print(f"Retrieval Invariant Violations: {violations} (Expected: 0)")
```

---

## 4. Automated Execution Instructions

To execute the verification script directly from your terminal:
```bash
npx ts-node -e "
  const fs = require('fs');
  const lines = fs.readFileSync('research_validation/final_verified_experiments/FINAL_INTENT_RESULTS.csv', 'utf8').trim().split('\n').slice(1);
  const correct = lines.filter(l => l.split(',')[4] === 'true').length;
  console.log('Verified Accuracy:', correct, '/', lines.length, '=', (correct/lines.length*100).toFixed(1)+'%');
"
```
Output:
`Verified Accuracy: 81 / 100 = 81.0%`
