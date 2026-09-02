import { JobStage, JobStatus } from '@/lib/domain';

/**
 * Job state machine and progress mapping.
 *
 *   QUEUED -> PROCESSING -> COMPLETED
 *   PROCESSING -> FAILED
 *   PROCESSING -> QUEUED        (watchdog recovery only, max 3 times)
 */

export const STAGE_ORDER = [
  JobStage.TRANSCRIPTION,
  JobStage.SUMMARY,
  JobStage.ACTION_ITEMS,
  JobStage.MIND_MAP,
] as const;

export type PipelineStage = (typeof STAGE_ORDER)[number];

interface ProgressRange {
  min: number;
  max: number;
}

const STAGE_PROGRESS: Record<string, ProgressRange> = {
  [JobStage.QUEUED]: { min: 0, max: 0 },
  [JobStage.TRANSCRIPTION]: { min: 10, max: 35 },
  [JobStage.SUMMARY]: { min: 35, max: 60 },
  [JobStage.ACTION_ITEMS]: { min: 60, max: 80 },
  [JobStage.MIND_MAP]: { min: 80, max: 95 },
  [JobStage.COMPLETED]: { min: 100, max: 100 },
};

export function progressRangeFor(stage: string): ProgressRange {
  return STAGE_PROGRESS[stage] ?? { min: 0, max: 0 };
}

/** Progress value at the start of a stage. */
export function progressAtStageStart(stage: string): number {
  return progressRangeFor(stage).min;
}

/** Progress value at the end of a stage (just before the next one begins). */
export function progressAtStageEnd(stage: string): number {
  return progressRangeFor(stage).max;
}

export function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage as PipelineStage);
}

export function nextStage(stage: string): PipelineStage | null {
  const index = stageIndex(stage);
  if (index === -1) return null;
  return STAGE_ORDER[index + 1] ?? null;
}

/** Legal JobStatus transitions. Anything else is a programming error. */
const LEGAL_STATUS_TRANSITIONS: Record<string, string[]> = {
  [JobStatus.QUEUED]: [JobStatus.PROCESSING, JobStatus.FAILED],
  [JobStatus.PROCESSING]: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.QUEUED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [JobStatus.QUEUED],
};

export function isLegalStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (LEGAL_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Terminal statuses stop client polling. */
export function isTerminalStatus(status: string): boolean {
  return status === JobStatus.COMPLETED || status === JobStatus.FAILED;
}
