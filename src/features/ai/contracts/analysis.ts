export interface RoadmapMilestone {
  id: string;
  title: string;
  objective: string;
  tasks: string[];
  dependencies: string[];
  risks: string[];
}

export interface RoadmapArtifact {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  milestones: RoadmapMilestone[];
  createdAt: string;
}

export interface AnalysisFinding {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
  implication: string;
  recommendation: string;
}

export interface CriticalAnalysisArtifact {
  id: string;
  projectId: string;
  executiveSummary: string;
  findings: AnalysisFinding[];
  contradictions: string[];
  openQuestions: string[];
  createdAt: string;
}
