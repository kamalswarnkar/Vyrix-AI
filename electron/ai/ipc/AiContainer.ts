/**
 * AiContainer.ts
 *
 * Dependency injection container for the entire AI subsystem.
 * Wires all modules together and provides them to AiIpcHandlers.
 *
 * This is the single composition root for the electron/ai/ subsystem.
 * All module instances are singletons within the container.
 *
 * Usage:
 *   const container = await AiContainer.create(storageRoot);
 *   const handlers  = new AiIpcHandlers(ipcMain, container);
 *   handlers.register();
 *
 * @param storageRoot  The root directory where all project data is stored.
 *                     Typically: app.getPath('userData') + '/vyrix-projects'
 */

import * as path from "node:path";

// ── Core ──────────────────────────────────────────────────────────────────────
import { HardwareDetector }        from "../core/HardwareDetector";
import { LlamaSidecar }            from "../core/LlamaSidecar";
import { OllamaAdapter }           from "../core/OllamaAdapter";
import { ModelRouter }             from "../core/ModelRouter";

// ── Storage ───────────────────────────────────────────────────────────────────
import { ProjectStateManager }     from "../project/ProjectStateManager";
import { MessageStore }            from "../conversation/MessageStore";
import { MemoryEngine }            from "../memory/MemoryEngine";
import { KeywordRepository }       from "../memory/KeywordRepository";

// ── Prompt ────────────────────────────────────────────────────────────────────
import { PromptCompiler }          from "../prompt/PromptCompiler";
import { GrammarRegistry }         from "../prompt/GrammarRegistry";
import { PromptEngine }            from "../prompt/PromptEngine";
import { PromptTemplates }         from "../prompt/PromptTemplates";

// ── Validation ────────────────────────────────────────────────────────────────
import { SchemaValidator }         from "../validation/SchemaValidator";

// ── Context ───────────────────────────────────────────────────────────────────
import { LruOptimizer }            from "../context/LruOptimizer";
import { ContextBuilder }          from "../context/ContextBuilder";
import { ContextInjector }         from "../context/ContextInjector";

// ── Memory ────────────────────────────────────────────────────────────────────
import { MemoryDistillation }      from "../memory/MemoryDistillation";

// ── Planning ──────────────────────────────────────────────────────────────────
import { AiPlanningEngine }        from "../planning/AiPlanningEngine";

// ── Evaluation ───────────────────────────────────────────────────────────────
import { AiEvaluationFramework }   from "../evaluation/AiEvaluationFramework";

// ── Interview ────────────────────────────────────────────────────────────────
import { AdaptiveInterviewEngine } from "../interview/AdaptiveInterviewEngine";

// ── Multimodal ────────────────────────────────────────────────────────────────
import { FileExtractor }           from "../multimodal/FileExtractor";
import { VisionProcessor }         from "../multimodal/VisionProcessor";

// ── Beta-2 modules ────────────────────────────────────────────────────────────
import { MissionClassifier }       from "../mission/MissionClassifier";
import { MissionWorkflowEngine }   from "../mission/MissionWorkflowEngine";
import { DesirabilityEvaluator }   from "../evaluation/DesirabilityEvaluator";
import { DVFEvaluator }            from "../evaluation/DVFEvaluator";
import { ProgressEvaluator }       from "../evaluation/ProgressEvaluator";
import { DecisionEngine }          from "../evaluation/DecisionEngine";
import { RoadmapVersioning }       from "../planning/RoadmapVersioning";

// ── Conversation ──────────────────────────────────────────────────────────────
import { ConversationStateManager } from "../conversation/ConversationStateManager";

// ─── AiContainerOptions ───────────────────────────────────────────────────────

export interface AiContainerOptions {
  storageRoot:    string;
  /** Path to the llama-server binary */
  llamaBinary?:   string;
  /** Path to the GGUF model file */
  modelPath?:     string;
  /** Override Ollama base URL. Default: http://localhost:11434 */
  ollamaBaseUrl?: string;
  /**
   * Directories ai:extract-file may read from (e.g. dialog-picked download dirs).
   * Unset = allow any path (legacy behavior — set this in production).
   */
  extractRoots?:  string[];
}

// ─── AiContainer ─────────────────────────────────────────────────────────────

export class AiContainer {
  readonly storageRoot: string;
  readonly extractRoots?: string[];

  // ── Singletons ────────────────────────────────────────────────────────────
  readonly sidecar:           LlamaSidecar;
  readonly ollama:            OllamaAdapter;
  readonly router:            ModelRouter;
  readonly projectState:      ProjectStateManager;
  readonly messageStore:      MessageStore;
  readonly keywords:          KeywordRepository;
  readonly compiler:          PromptCompiler;
  readonly grammar:           GrammarRegistry;
  readonly validator:         SchemaValidator;
  readonly promptEngine:      PromptEngine;
  readonly templates:         PromptTemplates;
  readonly lru:               LruOptimizer;
  readonly fileExtractor:     FileExtractor;
  readonly visionProcessor:   VisionProcessor;

  // ── Per-project lazy instances ────────────────────────────────────────────
  private readonly _memoryEngines     = new Map<string, MemoryEngine>();
  private readonly _contextBuilders   = new Map<string, ContextBuilder>();
  private readonly _convManagers      = new Map<string, ConversationStateManager>();

  // ── Higher-level engines ──────────────────────────────────────────────────
  readonly contextInjector:    ContextInjector;
  readonly memoryDistillation: MemoryDistillation;
  readonly planningEngine:     AiPlanningEngine;
  readonly evaluationFramework: AiEvaluationFramework;
  readonly interviewEngine:    AdaptiveInterviewEngine;

  // ── Beta-2 engines ────────────────────────────────────────────────────────
  readonly missionClassifier:    MissionClassifier;
  readonly desirabilityEvaluator: DesirabilityEvaluator;
  readonly dvfEvaluator:         DVFEvaluator;
  readonly progressEvaluator:    ProgressEvaluator;
  readonly decisionEngine:       DecisionEngine;
  readonly roadmapVersioning:    RoadmapVersioning;
  readonly missionWorkflow:      MissionWorkflowEngine;

  private constructor(opts: AiContainerOptions, sidecar: LlamaSidecar) {
    this.storageRoot  = opts.storageRoot;
    this.extractRoots = opts.extractRoots;

    // ── Core backends ─────────────────────────────────────────────────────
    this.sidecar = sidecar;
    this.ollama  = new OllamaAdapter({ baseUrl: opts.ollamaBaseUrl });
    this.router  = new ModelRouter(this.sidecar, this.ollama);

    // ── Storage ───────────────────────────────────────────────────────────
    this.projectState  = new ProjectStateManager(opts.storageRoot);
    this.messageStore  = new MessageStore();
    this.keywords      = new KeywordRepository();

    // ── Prompt ────────────────────────────────────────────────────────────
    this.compiler  = new PromptCompiler();
    this.grammar   = new GrammarRegistry();
    this.validator = new SchemaValidator();
    this.templates = new PromptTemplates();

    this.promptEngine = new PromptEngine(
      this.compiler,
      this.grammar,
      this.router as any, // ModelRouter satisfies PromptEngine's router interface
      this.validator,
    );

    // ── Context ───────────────────────────────────────────────────────────
    this.lru = new LruOptimizer();

    this.contextInjector = new ContextInjector(
      this.promptEngine,
      this.validator,
      // ContextBuilder is project-scoped, so we pass a factory
      this._buildContextBuilderForProjectDir.bind(this) as any,
      this.projectState,
    );

    // ── Multimodal ────────────────────────────────────────────────────────
    this.fileExtractor   = new FileExtractor();
    this.visionProcessor = new VisionProcessor();

    // ── Memory ────────────────────────────────────────────────────────────
    this.memoryDistillation = new MemoryDistillation(
      this._getOrCreateMemory("__global__"),
      this.promptEngine,
      this.keywords,
      this.validator,
    );

    // ── Planning ──────────────────────────────────────────────────────────
    this.planningEngine = new AiPlanningEngine(
      this.promptEngine,
      this.validator,
      this.projectState,
    );

    // ── Evaluation ────────────────────────────────────────────────────────
    this.evaluationFramework = new AiEvaluationFramework(
      this.promptEngine,
      this.validator,
    );

    // ── Interview ─────────────────────────────────────────────────────────
    this.interviewEngine = new AdaptiveInterviewEngine(
      this.promptEngine,
      this.validator,
      this.planningEngine,
      this.evaluationFramework,
    );

    // ── Beta-2 ────────────────────────────────────────────────────────────
    this.missionClassifier     = new MissionClassifier(this.promptEngine, this.validator);
    this.desirabilityEvaluator = new DesirabilityEvaluator(this.promptEngine, this.validator);
    this.dvfEvaluator          = new DVFEvaluator(this.promptEngine, this.validator);
    this.progressEvaluator     = new ProgressEvaluator(this.promptEngine, this.validator);
    this.decisionEngine        = new DecisionEngine(this.promptEngine, this.validator);
    this.roadmapVersioning     = new RoadmapVersioning(this.planningEngine, this.projectState);

    this.missionWorkflow = new MissionWorkflowEngine(
      this.missionClassifier,
      this.desirabilityEvaluator,
      this.dvfEvaluator,
      this.progressEvaluator,
      this.decisionEngine,
      this.planningEngine,
      this.roadmapVersioning,
      this.projectState,
    );
  }

  /**
   * Factory method — creates and initialises the container.
   * Starts the llama.cpp sidecar if modelPath is provided.
   */
  static async create(opts: AiContainerOptions): Promise<AiContainer> {
    // Sidecar detects hardware and computes its own launch flags internally
    const sidecar = new LlamaSidecar({
      binaryPath: opts.llamaBinary ?? "llama-server",
      modelPath:  opts.modelPath ?? "",
    });

    // Start sidecar in background — errors handled via circuit-breaker
    if (opts.modelPath) {
      sidecar.start().catch(() => {/* circuit-breaker handles this */});
    }

    return new AiContainer(opts, sidecar);
  }

  // ── Public per-project helpers ────────────────────────────────────────────

  getProjectDir(projectId: string): string {
    // Trust boundary: projectId comes from the renderer over IPC. Reject anything
    // that could escape storageRoot (path traversal / absolute paths).
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error(`Invalid projectId: "${projectId}"`);
    }
    return path.join(this.storageRoot, projectId);
  }

  getMemoryEngine(projectId: string): MemoryEngine {
    return this._getOrCreateMemory(this.getProjectDir(projectId));
  }

  getContextBuilder(projectId: string): ContextBuilder {
    const dir = this.getProjectDir(projectId);
    return this._buildContextBuilderForProjectDir(dir);
  }

  getConversationManager(projectId: string): ConversationStateManager {
    const dir = this.getProjectDir(projectId);
    if (!this._convManagers.has(dir)) {
      this._convManagers.set(dir, new ConversationStateManager(dir));
    }
    return this._convManagers.get(dir)!;
  }

  async getHistory(
    projectId:       string,
    conversationId?: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    if (!conversationId) return [];
    const mgr = this.getConversationManager(projectId);
    const messages = await mgr.readHistory(conversationId, { maxTurns: 20 });
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  /**
   * Gracefully stop the sidecar when the app quits.
   */
  async dispose(): Promise<void> {
    await this.sidecar.stop();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _getOrCreateMemory(projectDir: string): MemoryEngine {
    if (!this._memoryEngines.has(projectDir)) {
      this._memoryEngines.set(projectDir, new MemoryEngine(projectDir));
    }
    return this._memoryEngines.get(projectDir)!;
  }

  private _buildContextBuilderForProjectDir(projectDir: string): ContextBuilder {
    if (!this._contextBuilders.has(projectDir)) {
      const memory  = this._getOrCreateMemory(projectDir);
      const builder = new ContextBuilder(memory, this.keywords, this.lru);
      this._contextBuilders.set(projectDir, builder);
    }
    return this._contextBuilders.get(projectDir)!;
  }
}
