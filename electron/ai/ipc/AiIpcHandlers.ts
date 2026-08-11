/**
 * AiIpcHandlers.ts
 *
 * Registers all Electron IPC handlers for the ai.* namespace.
 * This file is the bridge between the renderer's `ipc.ai.*` calls
 * (typed in src/lib/ipc.ts + src/lib/electron.d.ts) and the
 * AI subsystem modules.
 *
 * IPC contract fulfilled:
 *   ipcMain.handle('ai:stream-message')    → PromptEngine.stream()
 *   ipcMain.handle('ai:get-context')       → ContextInjector.resolve()
 *   ipcMain.handle('ai:start-interview')   → AdaptiveInterviewEngine (step 1)
 *   ipcMain.handle('ai:interview-step')    → AdaptiveInterviewEngine (steps 2-6)
 *   ipcMain.handle('ai:generate-plan')     → AiPlanningEngine.generate()
 *   ipcMain.handle('ai:get-memory')        → MemoryEngine.formatAsContext()
 *   ipcMain.handle('ai:clear-memory')      → (delete memory log)
 *   ipcMain.handle('ai:extract-file')      → FileExtractor.extract()
 *
 * Streaming events emitted back to renderer:
 *   ai:stream:chunk  ({ chunk: string })
 *   ai:stream:done   ({ full: string, latencyMs: number })
 *   ai:stream:error  ({ error: string })
 *
 * Usage:
 *   const container = buildAiContainer(storageRoot);
 *   const handlers  = new AiIpcHandlers(ipcMain, container);
 *   handlers.register();
 */

import type { IpcMain, WebContents } from "electron";
import type { AiContainer }          from "./AiContainer";

/** Accepts a plain object (preferred — IPC serializes objects natively) or a JSON string (legacy). */
function parseArg<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

// ─── AiIpcHandlers ────────────────────────────────────────────────────────────

export class AiIpcHandlers {
  constructor(
    private readonly ipcMain:   IpcMain,
    private readonly container: AiContainer,
  ) {}

  /**
   * Register all IPC handlers. Call once during app startup.
   */
  register(): void {
    this.registerStreamMessage();
    this.registerGetContext();
    this.registerStartInterview();
    this.registerInterviewStep();
    this.registerGeneratePlan();
    this.registerGetMemory();
    this.registerClearMemory();
    this.registerExtractFile();
    // Beta-2
    this.registerClassifyMission();
    this.registerConfirmClassification();
    this.registerSaveProjectGoal();
    this.registerSaveEndGoal();
    this.registerEvaluateDesirability();
    this.registerGenerateIdeationRoadmap();
    this.registerRefineRoadmap();
    this.registerValidateProgress();
    this.registerStartIdeation();
    this.registerMarkIdeationReady();
    this.registerEvaluateDVF();
    this.registerRecordDecision();
    this.registerGenerateFinalRoadmap();
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  private registerStreamMessage(): void {
    this.ipcMain.handle(
      "ai:stream-message",
      async (
        event,
        message: string,
        conversationId?: string,
        projectId?: string,
        // Optional 4th arg keeps the channel backward compatible:
        //   mode      — "main" (project mentor/evaluator) | "pop" (general assistant)
        //   images    — base64 strings for Qwen2.5-VL multimodal input
        //   requestId — echoed on every stream event so concurrent streams don't interleave
        opts?: { mode?: "main" | "pop"; images?: string[]; requestId?: string },
      ) => {
        const requestId = opts?.requestId;
        const sender   = event.sender;
        const engine   = this.container.promptEngine;
        const history  = projectId
          ? await this.container.getHistory(projectId, conversationId)
          : [];

        // Build context if we have a project
        let contextBlock = "";
        if (projectId) {
          const contextResult = await this.container.contextInjector
            .resolve({ message, storageRoot: this.container.storageRoot })
            .catch(() => ({ ok: false, hasContext: false, context: "" }));
          contextBlock = contextResult.context;
        }

        await engine.stream(
          {
            systemPrompt: this.container.templates.chat.chatSystemPrompt({
              contextBlock,
              hasAttachments: (opts?.images?.length ?? 0) > 0,
              visionEnabled:  (opts?.images?.length ?? 0) > 0,
              mode:           opts?.mode ?? "main",
            }),
            userMessage:  message,
            contextBlock,
            history,
            images:       opts?.images,
          },
          (chunk)          => this.emit(sender, "ai:stream:chunk", { requestId, chunk }),
          (full, latencyMs) => {
            this.emit(sender, "ai:stream:done", { requestId, full, latencyMs });
            // Fire-and-forget memory distillation
            if (projectId) {
              const lastAssistant = full;
              this.container.memoryDistillation
                .distill(
                  this.container.getProjectDir(projectId),
                  conversationId ?? "default",
                  message,
                  lastAssistant,
                )
                .catch(() => {/* non-fatal */});
            }
          },
          (error)           => this.emit(sender, "ai:stream:error", { requestId, error }),
        );
      },
    );
  }

  private registerGetContext(): void {
    this.ipcMain.handle(
      "ai:get-context",
      async (_event, message: string) => {
        const result = await this.container.contextInjector.resolve({
          message,
          storageRoot: this.container.storageRoot,
        });
        return result;
      },
    );
  }

  private registerStartInterview(): void {
    this.ipcMain.handle(
      "ai:start-interview",
      async (_event, projectId: string) => {
        const { initialInterviewState } = await import("../interview/types");
        const state = initialInterviewState(projectId);

        const result = await this.container.interviewEngine.processUserTurn({
          projectId,
          userMessage: "", // empty — AI asks first question
          state,
        });

        return result;
      },
    );
  }

  private registerInterviewStep(): void {
    this.ipcMain.handle(
      "ai:interview-step",
      async (_event, projectId: string, userMessage: string, stateJson: string | object) => {
        const state = parseArg<never>(stateJson);
        const result = await this.container.interviewEngine.processUserTurn({
          projectId,
          userMessage,
          state,
        });
        return result;
      },
    );
  }

  private registerGeneratePlan(): void {
    this.ipcMain.handle(
      "ai:generate-plan",
      async (_event, projectId: string, contextBlock?: string) => {
        const result = await this.container.planningEngine.generate({
          projectId,
          contextBlock,
          persist: true,
        });
        return result;
      },
    );
  }

  private registerGetMemory(): void {
    this.ipcMain.handle(
      "ai:get-memory",
      async (_event, projectId: string) => {
        const memory = this.container.getMemoryEngine(projectId);
        const context = await memory.formatAsContext();
        return { ok: true, context };
      },
    );
  }

  private registerClearMemory(): void {
    this.ipcMain.handle(
      "ai:clear-memory",
      async (_event, projectId: string) => {
        const memory = this.container.getMemoryEngine(projectId);
        const exists = await memory.exists();
        if (!exists) return { ok: true };

        const { promises: fs } = await import("node:fs");
        const memPath = require("node:path").join(
          this.container.getProjectDir(projectId),
          "global-memory.log",
        );
        await fs.writeFile(memPath, "", "utf-8");
        return { ok: true };
      },
    );
  }

  private registerExtractFile(): void {
    this.ipcMain.handle(
      "ai:extract-file",
      async (_event, filePath: string) => {
        // Trust boundary: renderer supplies an arbitrary path. If extractRoots is
        // configured, only allow files inside those roots (realpath defeats symlinks).
        const roots = this.container.extractRoots;
        if (roots?.length) {
          const path = require("node:path") as typeof import("node:path");
          const real = await import("node:fs").then((m) => m.promises.realpath(filePath)).catch(() => null);
          const allowed = real !== null
            && roots.some((r) => real === r || real.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
          if (!allowed) {
            return { ok: false, name: "", text: "", chars: 0, truncated: false, error: "Path not allowed" };
          }
        }
        const result = await this.container.fileExtractor.extract(filePath);
        return result;
      },
    );
  }

  // ── Beta-2 handlers ───────────────────────────────────────────────────────

  private registerClassifyMission(): void {
    this.ipcMain.handle(
      "ai:classify-mission",
      async (_event, projectId: string, userMessage: string) => {
        return this.container.missionWorkflow.classify(projectId, userMessage);
      },
    );
  }

  private registerConfirmClassification(): void {
    this.ipcMain.handle(
      "ai:confirm-classification",
      async (_event, projectId: string, confirmed: boolean, correctedMessage?: string) => {
        return this.container.missionWorkflow.confirmClassification(
          projectId, confirmed, correctedMessage,
        );
      },
    );
  }

  private registerSaveProjectGoal(): void {
    this.ipcMain.handle(
      "ai:capture-goal",
      async (_event, projectId: string, goalJson: string | object) => {
        return this.container.missionWorkflow.saveProjectGoal(projectId, parseArg(goalJson) as never);
      },
    );
  }

  private registerSaveEndGoal(): void {
    this.ipcMain.handle(
      "ai:capture-end-goal",
      async (_event, projectId: string, endGoalJson: string | object) => {
        return this.container.missionWorkflow.saveEndGoal(projectId, parseArg(endGoalJson) as never);
      },
    );
  }

  private registerEvaluateDesirability(): void {
    this.ipcMain.handle(
      "ai:evaluate-desirability",
      async (_event, projectId: string, varsJson: string | object) => {
        const vars = parseArg<never>(varsJson);
        return this.container.missionWorkflow.evaluateDesirability(projectId, vars);
      },
    );
  }

  private registerGenerateIdeationRoadmap(): void {
    this.ipcMain.handle(
      "ai:generate-ideation-roadmap",
      async (_event, projectId: string, contextBlock?: string) => {
        return this.container.missionWorkflow.generateIdeationRoadmap(projectId, contextBlock);
      },
    );
  }

  private registerRefineRoadmap(): void {
    this.ipcMain.handle(
      "ai:refine-roadmap",
      async (_event, projectId: string, userRequest: string, contextBlock?: string) => {
        return this.container.missionWorkflow.refineRoadmap(projectId, userRequest, contextBlock);
      },
    );
  }

  private registerValidateProgress(): void {
    this.ipcMain.handle(
      "ai:validate-progress",
      async (_event, projectId: string, varsJson: string | object) => {
        const vars = parseArg<never>(varsJson);
        return this.container.missionWorkflow.validateProgress(projectId, vars);
      },
    );
  }

  private registerStartIdeation(): void {
    this.ipcMain.handle(
      "ai:start-ideation",
      async (_event, projectId: string) => {
        return this.container.missionWorkflow.startIdeation(projectId);
      },
    );
  }

  private registerMarkIdeationReady(): void {
    this.ipcMain.handle(
      "ai:ideation-ready",
      async (_event, projectId: string) => {
        return this.container.missionWorkflow.markIdeationReady(projectId);
      },
    );
  }

  private registerEvaluateDVF(): void {
    this.ipcMain.handle(
      "ai:evaluate-dvf",
      async (_event, projectId: string, varsJson: string | object) => {
        const vars = parseArg<never>(varsJson);
        return this.container.missionWorkflow.evaluateDVF(projectId, vars);
      },
    );
  }

  private registerRecordDecision(): void {
    this.ipcMain.handle(
      "ai:record-decision",
      async (_event, projectId: string, varsJson: string | object) => {
        const vars = parseArg<never>(varsJson);
        return this.container.missionWorkflow.recordDecision(projectId, vars);
      },
    );
  }

  private registerGenerateFinalRoadmap(): void {
    this.ipcMain.handle(
      "ai:generate-final-roadmap",
      async (_event, projectId: string, contextBlock?: string) => {
        return this.container.missionWorkflow.generateFinalRoadmap(projectId, contextBlock);
      },
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emit(sender: WebContents, channel: string, payload: unknown): void {
    if (!sender.isDestroyed()) {
      sender.send(channel, payload);
    }
  }
}
