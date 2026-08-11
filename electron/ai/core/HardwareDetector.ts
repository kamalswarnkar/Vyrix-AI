/**
 * HardwareDetector.ts
 *
 * Detects available system hardware and returns recommended
 * llama.cpp launch flags for the current machine.
 *
 * Memory tiers:
 *   < 8 GB  → context 4096, no GPU offload
 *   8-16 GB → context 8192, limited GPU offload
 *   > 16 GB → context 8192, full GPU offload
 */

import os from "node:os";
import { execSync } from "node:child_process";
import type { HardwareProfile } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;
const GB = MB * 1024;

// ─── HardwareDetector ─────────────────────────────────────────────────────────

export class HardwareDetector {
  detect(): HardwareProfile {
    const totalRamMb = Math.floor(os.totalmem() / MB);
    const cpuCount   = os.cpus().length;
    const gpuInfo    = this.detectGpu();

    const contextSize = totalRamMb < 8192 ? 4096 : 8192;
    // Use half the CPU cores for llama.cpp, minimum 2, maximum 8
    const threads = Math.min(8, Math.max(2, Math.floor(cpuCount / 2)));

    return {
      totalRamMb,
      cpuCount,
      gpuAvailable:  gpuInfo.available,
      gpuLayers:     gpuInfo.layers,
      contextSize,
      threads,
    };
  }

  /**
   * Converts the profile into llama.cpp CLI flags.
   */
  toLlamaFlags(profile: HardwareProfile, modelPath: string): string[] {
    const flags: string[] = [
      "--model",       modelPath,
      "--ctx-size",    String(profile.contextSize),
      "--threads",     String(profile.threads),
      "--host",        "127.0.0.1",
      "--port",        "8765",
      "--log-disable",              // suppress verbose logging to stdout
      "--parallel",    "1",         // single concurrent request
      "--cont-batching",            // enable continuous batching
    ];

    if (profile.gpuAvailable && profile.gpuLayers > 0) {
      flags.push("--n-gpu-layers", String(profile.gpuLayers));
    }

    return flags;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private detectGpu(): { available: boolean; layers: number } {
    const platform = process.platform;

    try {
      if (platform === "darwin") {
        // Apple Silicon — Metal backend, offload all layers
        const cpuModel = os.cpus()[0]?.model ?? "";
        if (/apple m[1-9]/i.test(cpuModel)) {
          return { available: true, layers: 99 };
        }
      }

      if (platform === "win32" || platform === "linux") {
        // Check for NVIDIA GPU
        const result = execSync("nvidia-smi --query-gpu=name --format=csv,noheader", {
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
        if (result.trim().length > 0) {
          return { available: true, layers: 35 }; // partial offload
        }
      }
    } catch {
      // GPU detection failed — fall back to CPU only
    }

    return { available: false, layers: 0 };
  }
}
