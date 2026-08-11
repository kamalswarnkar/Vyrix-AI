/**
 * Phase 11 — Benchmarking
 * Measures inference latency, streaming speed, token throughput, and
 * prompt size across all major task types.
 *
 * Run separately from the main calibration suite:
 *   npx tsx electron/ai/calibration/phases/11-benchmark.ts
 *
 * Results written to calibration/results/11-benchmark.json
 */

import { call, resolveActiveModel, DEFAULT_MODEL, OLLAMA_BASE } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "11-benchmark";
const RUNS  = 3; // average over N runs for stability

interface BenchCase {
  name:    string;
  prompt:  string;
  format?: "json";
}

const BENCH_CASES: BenchCase[] = [
  {
    name:   "short-json-interview-step",
    format: "json",
    prompt: `You are conducting interview step 1. Ask about project goals.
Output ONLY JSON: {"step_number":1,"ai_message":"...","skip_next_step":false,"extracted":{}}`,
  },
  {
    name:   "medium-json-planning",
    format: "json",
    prompt: `Generate a 5-step roadmap for "a todo app". Output ONLY JSON:
{"steps":[{"step":1,"title":"...","description":"...","methodology":"..."}],"total_steps":5,"summary":"..."}`,
  },
  {
    name:   "short-json-memory-delta",
    format: "json",
    prompt: `Extract one fact: User said "I'm using React". Output ONLY JSON: {"key":"Frontend Framework","value":"React","category":"technical","confidence":0.95}`,
  },
  {
    name:   "medium-json-evaluation",
    format: "json",
    prompt: `Evaluate: step goal "collect project name", user said "I'm building BudgetPal".
Output ONLY JSON: {"is_valid":true,"feedback":"...","suggestions":[],"ready_to_advance":true,"score":85}`,
  },
  {
    name:   "long-chat",
    prompt: `You are a strategic planning AI. The user is building a SaaS expense tracker with React and Node.js targeting small businesses, launching in Q3. They have a budget of $50k.
The user asks: "What are the three most important technical decisions I need to make in the next two weeks?"
Give a clear, direct, prioritised answer.`,
  },
  {
    name:   "vision-tiny-image",
    prompt: "Describe this image in one sentence.",
    // Vision call done inline below — prompt used for label only
  },
];

// Tiny white 10x10 PNG
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNk+A9QTwMJAAD//wMABAADjQGEOQAAAABJRU5ErkJggg==";

async function runN(n: number, fn: () => Promise<{ ok: boolean; latencyMs: number; outputTokens?: number }>): Promise<{
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgTokensPerSec: number;
  successRate: string;
}> {
  const results: Array<{ ok: boolean; latencyMs: number; outputTokens?: number }> = [];
  for (let i = 0; i < n; i++) {
    results.push(await fn());
    if (i < n - 1) await new Promise((r) => setTimeout(r, 500)); // short cooldown
  }
  const lats    = results.map((r) => r.latencyMs);
  const passed  = results.filter((r) => r.ok).length;
  const avgMs   = lats.reduce((s, v) => s + v, 0) / lats.length;
  const avgTps  = results
    .filter((r) => r.ok && r.outputTokens)
    .map((r) => (r.outputTokens! / r.latencyMs) * 1000)
    .reduce((s, v, _, a) => s + v / a.length, 0);

  return {
    avgLatencyMs:    Math.round(avgMs),
    minLatencyMs:    Math.min(...lats),
    maxLatencyMs:    Math.max(...lats),
    avgTokensPerSec: Math.round(avgTps),
    successRate:     `${passed}/${n}`,
  };
}

async function streamBenchmark(): Promise<{ chunksPerSec: number; totalMs: number; ok: boolean }> {
  const t0     = Date.now();
  let   chunks = 0;
  let   ok     = false;

  try {
    const model = await resolveActiveModel(); // ponytail: bypass DEFAULT_MODEL to handle name variants
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Count from 1 to 20, one number per line." }],
        stream:   true,
        options:  { temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body!.getReader();
    const dec    = new TextDecoder();
    let done     = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        const lines = dec.decode(value).split("\n").filter(Boolean);
        chunks += lines.length;
        const last = lines.at(-1);
        if (last) {
          const j = JSON.parse(last);
          if (j.done) { ok = true; break; }
        }
      }
    }
  } catch { /* ok=false */ }

  const totalMs = Date.now() - t0;
  return { chunksPerSec: Math.round((chunks / totalMs) * 1000), totalMs, ok };
}

async function main() {
  const cases: TestCase[] = [];

  // 1. Per-task-type latency benchmarks
  for (const c of BENCH_CASES) {
    if (c.name === "vision-tiny-image") continue; // handled separately

    const stats = await runN(RUNS, async () => {
      return call(
        [{ role: "user", content: c.prompt }],
        DEFAULT_MODEL,
        c.format,
      );
    });

    cases.push({
      name:      c.name,
      passed:    stats.successRate === `${RUNS}/${RUNS}`,
      latencyMs: stats.avgLatencyMs,
      notes:     `avg=${stats.avgLatencyMs}ms min=${stats.minLatencyMs}ms max=${stats.maxLatencyMs}ms tps=${stats.avgTokensPerSec} success=${stats.successRate}`,
    });
  }

  // 2. Vision benchmark — Ollama-native format: content=string, images=[raw base64]
  {
    const stats = await runN(RUNS, async () =>
      call(
        [{ role: "user", content: "Describe this image in one sentence.", images: [TINY_PNG_B64] } as any],
        DEFAULT_MODEL,
      )
    );
    cases.push({
      name:      "vision-tiny-image",
      passed:    stats.successRate === `${RUNS}/${RUNS}`,
      latencyMs: stats.avgLatencyMs,
      notes:     `avg=${stats.avgLatencyMs}ms tps=${stats.avgTokensPerSec} success=${stats.successRate}`,
    });
  }

  // 3. Streaming speed
  {
    const s = await streamBenchmark();
    cases.push({
      name:      "streaming-throughput",
      passed:    s.ok,
      latencyMs: s.totalMs,
      notes:     `${s.chunksPerSec} chunks/sec over ${s.totalMs}ms`,
    });
  }

  // 4. RAM usage (Linux only — reads /proc/meminfo)
  {
    let notes = "unavailable (non-Linux)";
    let passed = true;
    try {
      const { readFileSync } = await import("node:fs");
      const meminfo = readFileSync("/proc/meminfo", "utf-8");
      const totalKb    = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0");
      const availableKb = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "0");
      const usedGb     = ((totalKb - availableKb) / 1024 / 1024).toFixed(2);
      const totalGb    = (totalKb / 1024 / 1024).toFixed(2);
      notes = `used=${usedGb}GB / total=${totalGb}GB`;
      // Warn if more than 80% used
      if ((totalKb - availableKb) / totalKb > 0.8) passed = false;
    } catch { /* not Linux */ }
    cases.push({ name: "ram-usage", passed, notes });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);

  // Print summary table
  console.log("\n━━━ BENCHMARK SUMMARY ━━━");
  console.log(`Model: ${DEFAULT_MODEL}`);
  for (const c of cases) {
    if (c.notes && c.latencyMs) {
      console.log(`  ${c.name.padEnd(32)} ${c.notes}`);
    }
  }
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
