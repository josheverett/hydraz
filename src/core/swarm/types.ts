export type SwarmPhase =
  | 'created'
  | 'starting'
  | 'investigating'
  | 'architecting'
  | 'planning'
  | 'architect-reviewing'
  | 'fanning-out'
  | 'syncing'
  | 'merging'
  | 'reviewing'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'stopped';

export type WorkerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stalled';

export type TaskStatus = 'pending' | 'assigned' | 'completed' | 'failed';

export type StageStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export type ReviewCategory = 'architectural' | 'implementation';

export type ReviewVerdict = 'approve' | 'changes-requested';

export interface TokenUsage {
  input: number;
  output: number;
}

export interface TaskLedgerTask {
  id: string;
  title: string;
  description: string;
  assignedWorker: string;
  ownedPaths: string[];
  acceptanceCriteria: string[];
  interfaceContracts: string[];
  status: TaskStatus;
}

export interface TaskLedgerWorker {
  branch: string;
  status: WorkerStatus;
  startedAt?: string;
  completedAt?: string;
  cost?: number;
  tokens?: TokenUsage;
}

export interface TaskLedgerStage {
  status: StageStatus;
  cost?: number;
  rounds?: number;
}

export interface TaskLedger {
  swarmPhase: SwarmPhase;
  baseCommit: string;
  outerLoop: number;
  consensusRound: number;
  tasks: TaskLedgerTask[];
  workers: Record<string, TaskLedgerWorker>;
  stages: Record<string, TaskLedgerStage>;
}

export interface OwnershipEntry {
  paths: string[];
  exclusive: boolean;
}

export interface OwnershipMap {
  workers: Record<string, OwnershipEntry>;
  shared: string[];
}

export interface ReviewFinding {
  category: ReviewCategory;
  description: string;
  file?: string;
  line?: number;
  severity?: string;
  affectedWorker?: string;
}

export interface ReviewResult {
  reviewer: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  summary: string;
}

export interface ReviewAggregate {
  approved: boolean;
  architecturalFindings: ReviewFinding[];
  implementationFindings: ReviewFinding[];
  reviews: ReviewResult[];
}

export interface ExecutionContext {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: import('../config/schema.js').HydrazConfig;
  swarmDir: string;
}

export interface SwarmConfig {
  defaultWorkerCount: number;
  defaultReviewers: string[];
  consensusMaxRounds: number;
  outerLoopMaxIterations: number;
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  defaultWorkerCount: 3,
  defaultReviewers: ['carmack', 'metz', 'torvalds'],
  consensusMaxRounds: 10,
  outerLoopMaxIterations: 5,
};
