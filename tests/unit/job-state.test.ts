import { describe, expect, it } from 'vitest';
import {
  isLegalStatusTransition,
  isTerminalStatus,
  nextStage,
  progressAtStageEnd,
  progressAtStageStart,
  progressRangeFor,
  STAGE_ORDER,
} from '@/lib/jobs/states';
import { JobStage, JobStatus } from '@/lib/domain';

describe('mandatory pipeline order', () => {
  it('is Transcription -> Summary -> Action Items -> Mind Map', () => {
    expect(STAGE_ORDER).toEqual([JobStage.TRANSCRIPTION, JobStage.SUMMARY, JobStage.ACTION_ITEMS, JobStage.MIND_MAP]);
  });

  it('has no stage after the mind map', () => {
    expect(nextStage(JobStage.MIND_MAP)).toBeNull();
  });

  it('chains each stage to the next', () => {
    expect(nextStage(JobStage.TRANSCRIPTION)).toBe(JobStage.SUMMARY);
    expect(nextStage(JobStage.SUMMARY)).toBe(JobStage.ACTION_ITEMS);
    expect(nextStage(JobStage.ACTION_ITEMS)).toBe(JobStage.MIND_MAP);
  });
});

describe('progress mapping', () => {
  it('starts at 0 when queued and ends at 100 when completed', () => {
    expect(progressAtStageStart(JobStage.QUEUED)).toBe(0);
    expect(progressAtStageStart(JobStage.COMPLETED)).toBe(100);
    expect(progressAtStageEnd(JobStage.COMPLETED)).toBe(100);
  });

  it('keeps every stage inside its contracted range', () => {
    expect(progressRangeFor(JobStage.TRANSCRIPTION)).toEqual({ min: 10, max: 35 });
    expect(progressRangeFor(JobStage.SUMMARY)).toEqual({ min: 35, max: 60 });
    expect(progressRangeFor(JobStage.ACTION_ITEMS)).toEqual({ min: 60, max: 80 });
    expect(progressRangeFor(JobStage.MIND_MAP)).toEqual({ min: 80, max: 95 });
  });

  it('is monotonically non-decreasing across the pipeline', () => {
    let previous = 0;
    for (const stage of [...STAGE_ORDER, JobStage.COMPLETED]) {
      const start = progressAtStageStart(stage);
      expect(start).toBeGreaterThanOrEqual(previous);
      const end = progressAtStageEnd(stage);
      expect(end).toBeGreaterThanOrEqual(start);
      previous = end;
    }
    expect(previous).toBe(100);
  });
});

describe('job state machine', () => {
  it('allows QUEUED -> PROCESSING -> COMPLETED', () => {
    expect(isLegalStatusTransition(JobStatus.QUEUED, JobStatus.PROCESSING)).toBe(true);
    expect(isLegalStatusTransition(JobStatus.PROCESSING, JobStatus.COMPLETED)).toBe(true);
  });

  it('allows PROCESSING -> FAILED', () => {
    expect(isLegalStatusTransition(JobStatus.PROCESSING, JobStatus.FAILED)).toBe(true);
  });

  it('allows PROCESSING -> QUEUED only for watchdog recovery', () => {
    expect(isLegalStatusTransition(JobStatus.PROCESSING, JobStatus.QUEUED)).toBe(true);
  });

  it('never allows QUEUED to jump straight to COMPLETED', () => {
    expect(isLegalStatusTransition(JobStatus.QUEUED, JobStatus.COMPLETED)).toBe(false);
  });

  it('treats COMPLETED as terminal', () => {
    expect(isLegalStatusTransition(JobStatus.COMPLETED, JobStatus.PROCESSING)).toBe(false);
    expect(isLegalStatusTransition(JobStatus.COMPLETED, JobStatus.FAILED)).toBe(false);
    expect(isLegalStatusTransition(JobStatus.COMPLETED, JobStatus.QUEUED)).toBe(false);
  });

  it('stops client polling on COMPLETED or FAILED', () => {
    expect(isTerminalStatus(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(JobStatus.FAILED)).toBe(true);
    expect(isTerminalStatus(JobStatus.QUEUED)).toBe(false);
    expect(isTerminalStatus(JobStatus.PROCESSING)).toBe(false);
  });
});
