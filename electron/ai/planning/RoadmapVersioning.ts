/**
 * RoadmapVersioning.ts
 *
 * Version-safe roadmap refinement wrapper for AiPlanningEngine.
 * Ensures roadmap history is never overwritten — each refine call
 * appends a new RoadmapVersion to roadmap_versions[].
 *
 * Usage:
 *   const versioning = new RoadmapVersioning(planningEngine, projectState);
 *   const result = await versioning.refineWithHistory({
 *     projectId, feedback, contextBlock
 *   });
 *   // result.versions contains full version history
 */

import { AiPlanningEngine, type RefinePlanOptions } from "./AiPlanningEngine";
import { ProjectStateManager }                       from "../project/ProjectStateManager";
import type { RoadmapEntry, RoadmapVersion }         from "../project/types";

export interface RefineWithHistoryOptions {
  projectId:    string;
  userRequest:  string;
  contextBlock?: string;
}

export interface RefineWithHistoryResult {
  ok:       boolean;
  roadmap?:  RoadmapEntry[];
  versions?: RoadmapVersion[];
  error?:    string;
}

export class RoadmapVersioning {
  constructor(
    private readonly planning:      AiPlanningEngine,
    private readonly projectState:  ProjectStateManager,
  ) {}

  async refineWithHistory(opts: RefineWithHistoryOptions): Promise<RefineWithHistoryResult> {
    const { projectId, userRequest, contextBlock } = opts;

    // Load current meta to get existing roadmap + version history
    const metaResult = await this.projectState.getMeta(projectId);
    if (!metaResult.ok) return { ok: false, error: metaResult.error };

    const meta = metaResult.data;
    const currentRoadmap = meta.roadmap ?? [];
    const existingVersions: RoadmapVersion[] = meta.roadmap_versions ?? [];
    const nextVersion = existingVersions.length + 1;

    // Snapshot the current roadmap before refining
    const snapshot: RoadmapVersion = {
      version:          nextVersion,
      timestamp:        new Date().toISOString(),
      roadmap:          currentRoadmap,
      user_feedback:    userRequest,
      previous_version: existingVersions.length > 0 ? nextVersion - 1 : undefined,
    };

    // Run the actual refine (this generates a new roadmap and persists it)
    const refineResult = await this.planning.refine({
      projectId,
      userRequest,
      contextBlock,
    });

    if (!refineResult.ok) {
      return { ok: false, error: refineResult.error };
    }

    // Append snapshot + save version history to project meta
    const updatedVersions = [...existingVersions, snapshot];
    await this.projectState.updateMeta(projectId, {
      roadmap_versions:        updatedVersions,
      current_roadmap_version: nextVersion,
    });

    return {
      ok:       true,
      roadmap:  refineResult.plan?.steps as unknown as RoadmapEntry[] ?? [],
      versions: updatedVersions,
    };
  }
}
