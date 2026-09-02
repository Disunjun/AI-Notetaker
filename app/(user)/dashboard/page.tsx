'use client';

import { useCallback, useState } from 'react';
import { UploadDropzone } from '@/components/UploadDropzone';
import { JobProgress } from '@/components/JobProgress';
import { NotesList } from '@/components/NotesList';
import type { JobDto } from '@/types';

interface Uploaded {
  noteId: string;
  jobId: string;
  fileName: string;
}

export default function DashboardPage() {
  const [activeJob, setActiveJob] = useState<Uploaded | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onUploaded = useCallback((result: Uploaded) => {
    setActiveJob(result);
    setRefreshKey((key) => key + 1);
  }, []);

  const onSettled = useCallback((job: JobDto) => {
    setRefreshKey((key) => key + 1);
    if (job.status === 'COMPLETED' && job.noteId) {
      // Keep the progress panel visible; the history list refreshes in place.
      setActiveJob((current) => (current?.jobId === job.id ? current : current));
    }
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-ink-900">Your meetings</h1>
        <p className="mt-1 text-sm text-ink-500">
          Upload audio to get a transcript, executive summary, action items and an interactive mind map.
        </p>
      </section>

      <UploadDropzone onUploaded={onUploaded} />

      {activeJob && <JobProgress jobId={activeJob.jobId} onSettled={onSettled} />}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-900">History</h2>
        <NotesList refreshKey={refreshKey} />
      </section>
    </div>
  );
}
