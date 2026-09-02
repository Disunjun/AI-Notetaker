'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '@/components/api';
import type { JobDto, QueuePositionDto } from '@/types';

/**
 * Polls GET /api/jobs/:jobId every 4 seconds and stops as soon as the job
 * reaches COMPLETED or FAILED.
 */
export const POLL_INTERVAL_MS = 4_000;

const STAGE_LABELS: Record<string, string> = {
  QUEUED: 'Waiting in queue',
  TRANSCRIPTION: 'Transcribing audio',
  SUMMARY: 'Writing executive summary',
  ACTION_ITEMS: 'Extracting action items',
  MIND_MAP: 'Building mind map',
  COMPLETED: 'Completed',
};

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-800';
    case 'FAILED':
      return 'bg-red-100 text-red-800';
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}

export function useJobPolling(jobId: string | null, onSettled: (job: JobDto) => void) {
  const [job, setJob] = useState<JobDto | null>(null);
  const [position, setPosition] = useState<QueuePositionDto | null>(null);

  const tick = useCallback(async () => {
    if (!jobId) return;
    try {
      const current = await api<JobDto>(`/api/jobs/${jobId}`);
      setJob(current);
      if (current.status === 'QUEUED') {
        const pos = await api<QueuePositionDto>(`/api/jobs/${jobId}/queue-position`);
        setPosition(pos);
      } else {
        setPosition(null);
      }
      if (current.status === 'COMPLETED' || current.status === 'FAILED') {
        onSettled(current);
      }
    } catch (error) {
      // A 404 or 401 means polling should stop; anything else is transient.
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 404)) setJob(null);
    }
  }, [jobId, onSettled]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const run = async () => {
      await tick();
      if (!active) return;
    };
    void run();
    const timer = setInterval(() => void run(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, tick]);

  return { job, position };
}

export function JobProgress({ jobId, onSettled }: { jobId: string | null; onSettled: (job: JobDto) => void }) {
  const { job, position } = useJobPolling(jobId, onSettled);
  if (!job) return null;

  const terminal = job.status === 'COMPLETED' || job.status === 'FAILED';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink-800">{STAGE_LABELS[job.stage] ?? job.stage}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {job.status === 'QUEUED' && position?.position
              ? `Position ${position.position} of ${position.totalWaiting} in queue`
              : `Attempt ${job.attempts}`}
          </p>
        </div>
        <span className={`badge ${statusBadgeClass(job.status)}`}>{job.status}</span>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full transition-all ${job.status === 'FAILED' ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${Math.max(2, job.progress)}%` }}
        />
      </div>
      <p className="mt-2 text-right text-xs text-ink-500">{job.progress}%</p>

      {job.status === 'FAILED' && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {job.errorCode}: {job.errorMessage ?? 'Processing failed'}
        </p>
      )}
      {terminal && job.status === 'COMPLETED' && (
        <p className="mt-3 text-sm text-emerald-700">Done — scroll down to see your notes.</p>
      )}
    </div>
  );
}
