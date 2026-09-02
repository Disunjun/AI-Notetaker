'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/api';
import { statusBadgeClass } from '@/components/JobProgress';
import type { JobDto, NoteListItemDto, Paginated } from '@/types';

const POLL_MS = 4_000;

export function NotesList({ refreshKey }: { refreshKey: number }) {
  const [page, setPage] = useState<Paginated<NoteListItemDto> | null>(null);
  const [liveJobs, setLiveJobs] = useState<Record<string, JobDto>>({});

  const load = useCallback(async () => {
    const data = await api<Paginated<NoteListItemDto>>('/api/notes?pageSize=20');
    setPage(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Keep processing rows fresh without reloading the whole list.
  useEffect(() => {
    const active = (page?.items ?? []).filter((note) => {
      const status = note.latestJob?.status;
      return status === 'QUEUED' || status === 'PROCESSING';
    });
    if (active.length === 0) return;

    const timer = setInterval(async () => {
      const updates: Record<string, JobDto> = {};
      let changed = false;
      for (const note of active) {
        if (!note.latestJob) continue;
        try {
          const job = await api<JobDto>(`/api/jobs/${note.latestJob.id}`);
          updates[note.id] = job;
          if (job.status === 'COMPLETED' || job.status === 'FAILED') changed = true;
        } catch {
          /* transient */
        }
      }
      setLiveJobs((prev) => ({ ...prev, ...updates }));
      if (changed) await load();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [page, load]);

  if (!page) return <p className="text-sm text-ink-500">Loading your notes…</p>;
  if (page.items.length === 0) return <p className="text-sm text-ink-500">No notes yet. Upload an audio file to get started.</p>;

  return (
    <div className="card overflow-hidden p-0">
      <table className="table">
        <thead>
          <tr>
            <th className="th">Title</th>
            <th className="th">Size</th>
            <th className="th">Status</th>
            <th className="th">Uploaded</th>
            <th className="th" />
          </tr>
        </thead>
        <tbody>
          {page.items.map((note) => {
            const job = liveJobs[note.id] ?? note.latestJob;
            return (
              <tr key={note.id}>
                <td className="td font-medium text-ink-800">{note.title}</td>
                <td className="td text-ink-500">{Math.round(note.fileSizeBytes / 1024)} KB</td>
                <td className="td">
                  <span className={`badge ${statusBadgeClass(job?.status ?? note.status)}`}>{job?.status ?? note.status}</span>
                  {job && (job.status === 'PROCESSING' || job.status === 'QUEUED') && (
                    <span className="ml-2 text-xs text-ink-500">{job.progress}%</span>
                  )}
                </td>
                <td className="td text-ink-500">{new Date(note.createdAt).toLocaleString()}</td>
                <td className="td text-right">
                  <a className="text-sm text-accent hover:underline" href={`/notes/${note.id}`}>
                    Open
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
