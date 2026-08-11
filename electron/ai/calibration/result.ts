/**
 * result.ts — structured result writer for calibration phases.
 *
 * Each phase appends to calibration/results/<phase>.json.
 * run-all.ts merges everything into results/summary.json.
 */

import * as fs   from "node:fs";
import * as path from "node:path";

export interface TestCase {
  name:       string;
  passed:     boolean;
  latencyMs?: number;
  notes?:     string;
  raw?:       string;   // raw model output (trimmed to 500 chars for log size)
  parsed?:    unknown;  // parsed object if applicable
}

export interface PhaseResult {
  phase:      string;
  timestamp:  string;
  model:      string;
  passed:     number;
  failed:     number;
  total:      number;
  passRate:   string;
  avgLatency: string;
  cases:      TestCase[];
}

const RESULTS_DIR = path.resolve(__dirname, "results");

export function writeResults(phase: string, model: string, cases: TestCase[]): PhaseResult {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const passed  = cases.filter((c) => c.passed).length;
  const failed  = cases.length - passed;
  const avgMs   = cases.filter((c) => c.latencyMs).reduce((s, c) => s + (c.latencyMs ?? 0), 0)
                  / Math.max(1, cases.filter((c) => c.latencyMs).length);

  const result: PhaseResult = {
    phase,
    timestamp:  new Date().toISOString(),
    model,
    passed,
    failed,
    total:      cases.length,
    passRate:   `${Math.round((passed / Math.max(1, cases.length)) * 100)}%`,
    avgLatency: `${Math.round(avgMs)}ms`,
    cases,
  };

  const outPath = path.join(RESULTS_DIR, `${phase}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  return result;
}

export function printSummary(result: PhaseResult): void {
  const icon = result.failed === 0 ? "✅" : result.passed === 0 ? "❌" : "⚠️";
  console.log(`\n${icon} Phase: ${result.phase}`);
  console.log(`   Passed: ${result.passed}/${result.total}  (${result.passRate})  avg ${result.avgLatency}`);
  for (const c of result.cases) {
    const mark = c.passed ? "  ✓" : "  ✗";
    const note = c.notes ? `  — ${c.notes}` : "";
    console.log(`${mark} ${c.name}${note}`);
  }
}
