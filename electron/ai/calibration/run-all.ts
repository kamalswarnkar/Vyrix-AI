/**
 * run-all.ts — orchestrates all calibration phases sequentially.
 * Writes merged summary to calibration/results/summary.json.
 *
 * Usage:
 *   npx tsx electron/ai/calibration/run-all.ts
 *   npx tsx electron/ai/calibration/run-all.ts 01 02 05   # run specific phases
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { DEFAULT_MODEL } from "./ollama";

const RESULTS_DIR  = path.resolve(__dirname, "results");
const PHASES_DIR   = path.resolve(__dirname, "phases");

const ALL_PHASES = ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16"] as const;

interface PhaseResult {
  phase:     string;
  passed:    number;
  failed:    number;
  total:     number;
  passRate:  string;
  avgLatency: string;
}

interface Summary {
  timestamp:   string;
  model:       string;
  totalPassed: number;
  totalFailed: number;
  totalTests:  number;
  overallPass: string;
  phases:      PhaseResult[];
}

function run(phase: string): { exitCode: number; result?: PhaseResult } {
  const script = path.join(PHASES_DIR, `${phase}-*.ts`);
  // Glob the actual filename
  const files = fs.readdirSync(PHASES_DIR).filter((f) => f.startsWith(`${phase}-`));
  if (files.length === 0) {
    console.error(`  ✗ Phase ${phase}: no script found in ${PHASES_DIR}`);
    return { exitCode: 1 };
  }
  const scriptPath = path.join(PHASES_DIR, files[0]!);
  console.log(`\n━━━ Phase ${phase}: ${files[0]} ━━━`);
  try {
    execSync(`npx tsx "${scriptPath}"`, { stdio: "inherit" });
  } catch {
    // non-zero exit — results file still written by the script
  }
  // Read result file regardless of exit code
  const resultPath = path.join(RESULTS_DIR, `${phase}-*.json`);
  const resultFiles = fs.existsSync(RESULTS_DIR)
    ? fs.readdirSync(RESULTS_DIR).filter((f) => f.startsWith(`${phase}-`) || f.startsWith(phase))
    : [];

  // Try exact match first: "01-setup.json", "01.json"
  const jsonFile = resultFiles.find((f) => f.startsWith(phase));
  if (!jsonFile) return { exitCode: 1 };

  try {
    const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, jsonFile), "utf-8")) as PhaseResult;
    return { exitCode: data.failed > 0 ? 1 : 0, result: data };
  } catch {
    return { exitCode: 1 };
  }
}

function main() {
  const args   = process.argv.slice(2);
  const phases = args.length > 0 ? args : [...ALL_PHASES];

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const results:  PhaseResult[] = [];
  let   anyFail = false;

  for (const p of phases) {
    const { exitCode, result } = run(p);
    if (exitCode !== 0) anyFail = true;
    if (result)         results.push(result);
  }

  // Write summary
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalTests  = results.reduce((s, r) => s + r.total, 0);

  const summary: Summary = {
    timestamp:   new Date().toISOString(),
    model:       DEFAULT_MODEL,
    totalPassed,
    totalFailed,
    totalTests,
    overallPass: `${Math.round((totalPassed / Math.max(1, totalTests)) * 100)}%`,
    phases:      results,
  };

  const summaryPath = path.join(RESULTS_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`CALIBRATION SUMMARY — ${summary.overallPass} (${totalPassed}/${totalTests})`);
  console.log(`Model: ${summary.model}`);
  for (const r of results) {
    const icon = r.failed === 0 ? "✅" : r.passed === 0 ? "❌" : "⚠️";
    console.log(`  ${icon} ${r.phase.padEnd(12)} ${r.passRate.padStart(4)}  (${r.passed}/${r.total})  avg ${r.avgLatency}`);
  }
  console.log(`\nResults saved to: ${summaryPath}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(anyFail ? 1 : 0);
}

main();
