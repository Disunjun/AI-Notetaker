'use client';

import { useCallback, useState } from 'react';
import { JobProgress } from '@/components/JobProgress';
import { ActionItems } from '@/components/ActionItems';
import { MindMap } from '@/components/MindMap';
import type { ActionItemDto, JobDto, MindMapDto, SummaryDto, TranscriptDto } from '@/types';

export interface NoteViewProps {
  noteId: string;
  title: string;
  originalName: string;
  status: string;
  job: JobDto | null;
  transcript: TranscriptDto | null;
  summary: SummaryDto | null;
  actionItems: ActionItemDto[];
  mindMap: MindMapDto | null;
}

type Tab = 'transcript' | 'summary' | 'actions' | 'mindmap';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'summary', label: 'Executive summary' },
  { id: 'actions', label: 'Action items' },
  { id: 'mindmap', label: 'Mind map' },
];

export function NoteView(props: NoteViewProps) {
  const [tab, setTab] = useState<Tab>('summary');
  const [settled, setSettled] = useState(false);

  const onSettled = useCallback(() => setSettled(true), []);
  const processing = Boolean(props.job && (props.job.status === 'QUEUED' || props.job.status === 'PROCESSING'));

  return (
    <div className="space-y-6">
      <header>
        <a href="/dashboard" className="text-sm text-accent hover:underline">← Back to dashboard</a>
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">{props.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{props.originalName}</p>
      </header>

      {processing && <JobProgress jobId={props.job?.id ?? null} onSettled={onSettled} />}

      {(settled || !processing) && (
        <section>
          <nav className="mb-4 flex flex-wrap gap-2">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={tab === entry.id ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="card">
            {tab === 'transcript' &&
              (props.transcript ? (
                <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-800">
                  {props.transcript.content}
                </pre>
              ) : (
                <Empty label="Transcript is not available yet." />
              ))}

            {tab === 'summary' &&
              (props.summary ? (
                <article className="prose-sm max-w-none space-y-3 text-sm leading-relaxed text-ink-800">
                  {props.summary.content.split('\n').map((line, index) =>
                    line.startsWith('## ') ? (
                      <h2 key={index} className="mt-4 text-base font-semibold text-ink-900">
                        {line.replace(/^##\s*/, '')}
                      </h2>
                    ) : line.startsWith('# ') ? (
                      <h1 key={index} className="text-lg font-semibold text-ink-900">
                        {line.replace(/^#\s*/, '')}
                      </h1>
                    ) : line.startsWith('- ') ? (
                      <p key={index} className="pl-4">
                        • {line.replace(/^-\s*/, '')}
                      </p>
                    ) : line.trim() ? (
                      <p key={index}>{line}</p>
                    ) : null,
                  )}
                </article>
              ) : (
                <Empty label="Summary is not available yet." />
              ))}

            {tab === 'actions' && <ActionItems items={props.actionItems} />}

            {tab === 'mindmap' && (props.mindMap ? <MindMap markdown={props.mindMap.markdown} /> : <Empty label="Mind map is not available yet." />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-ink-500">{label}</p>;
}
