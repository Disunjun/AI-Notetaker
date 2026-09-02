'use client';

import { useCallback, useRef, useState } from 'react';
import { apiUpload, ApiClientError } from '@/components/api';

const ACCEPTED = '.mp3,.m4a,.wav,.mpeg,audio/mpeg,audio/mp4,audio/wav';

interface Uploaded {
  noteId: string;
  jobId: string;
  fileName: string;
}

export function UploadDropzone({ onUploaded }: { onUploaded: (result: Uploaded) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const result = await apiUpload<Uploaded>(file);
        onUploaded(result);
      } catch (err) {
        setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging ? 'border-accent bg-accent-soft' : 'border-ink-300 bg-white hover:border-accent'
        }`}
      >
        <p className="text-base font-medium text-ink-800">{busy ? 'Uploading…' : 'Drop meeting audio here'}</p>
        <p className="mt-1 text-sm text-ink-500">mp3, m4a, wav or mpeg — or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
