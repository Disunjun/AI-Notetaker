'use client';

import { useState } from 'react';
import { api } from '@/components/api';
import type { ActionItemDto } from '@/types';

/**
 * Action items. Checkbox state is persisted with PATCH /api/action-items/:id so
 * it survives a reload.
 */
export function ActionItems({ items }: { items: ActionItemDto[] }) {
  const [rows, setRows] = useState(items);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const toggle = async (item: ActionItemDto) => {
    setPending((prev) => ({ ...prev, [item.id]: true }));
    setError(null);
    // Optimistic update; reverted if the server rejects it.
    const next = !item.completed;
    setRows((prev) => prev.map((row) => (row.id === item.id ? { ...row, completed: next } : row)));
    try {
      const updated = await api<ActionItemDto>(`/api/action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completed: next }),
      });
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err) {
      setRows((prev) => prev.map((row) => (row.id === item.id ? { ...row, completed: item.completed } : row)));
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setPending((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  if (rows.length === 0) return <p className="text-sm text-ink-500">No action items were found in this meeting.</p>;

  const remaining = rows.filter((row) => !row.completed).length;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-500">
        {remaining} of {rows.length} open
      </p>
      <ul className="space-y-2">
        {rows.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-lg border border-ink-100 bg-white px-3 py-2">
            <input
              id={`ai-${item.id}`}
              type="checkbox"
              className="mt-1 h-4 w-4 accent-indigo-600"
              checked={item.completed}
              disabled={pending[item.id]}
              onChange={() => void toggle(item)}
            />
            <label htmlFor={`ai-${item.id}`} className="flex-1 text-sm">
              <span className={item.completed ? 'text-ink-500 line-through' : 'text-ink-800'}>{item.content}</span>
              {(item.assignee || item.dueDate) && (
                <span className="mt-0.5 block text-xs text-ink-500">
                  {item.assignee ? `Owner: ${item.assignee}` : ''}
                  {item.assignee && item.dueDate ? ' · ' : ''}
                  {item.dueDate ? `Due: ${item.dueDate}` : ''}
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
