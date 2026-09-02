import { ErrorCode } from '@/lib/errors';
import { permanentError } from '@/lib/ai/types';

/**
 * AI output validation.
 *
 * Model output is untrusted. Every stage result is parsed and shape-checked
 * before it is persisted; anything malformed raises AI_RESPONSE_INVALID, which
 * is a PERMANENT failure (no retry, no fallback).
 */

export interface ParsedActionItem {
  content: string;
  assignee: string | null;
  dueDate: string | null;
}

export const MAX_ACTION_ITEMS = 20;

/** Strip accidental markdown code fences and extract the first JSON object. */
export function extractJsonObject(text: string): string {
  const fenced = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw permanentError('validation', ErrorCode.AI_RESPONSE_INVALID, 'Response did not contain a JSON object');
  }
  return fenced.slice(start, end + 1);
}

export function parseActionItems(text: string, provider: string): ParsedActionItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Action items response was not valid JSON');
  }

  const container = parsed as { actionItems?: unknown };
  if (!Array.isArray(container.actionItems)) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Action items response is missing an actionItems array');
  }

  const items: ParsedActionItem[] = [];
  for (const raw of container.actionItems.slice(0, MAX_ACTION_ITEMS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as { content?: unknown; assignee?: unknown; dueDate?: unknown };
    const content = typeof candidate.content === 'string' ? candidate.content.trim() : '';
    if (!content) continue;
    items.push({
      content: content.slice(0, 1000),
      assignee: typeof candidate.assignee === 'string' && candidate.assignee.trim() ? candidate.assignee.trim().slice(0, 120) : null,
      dueDate: normaliseDate(candidate.dueDate),
    });
  }
  return items;
}

function normaliseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Validate the mind-map outline: heading plus nested list, nothing else. */
export function validateMindMapMarkdown(text: string, provider: string): string {
  const trimmed = text.replace(/^\s*```(?:markdown|md)?/i, '').replace(/```\s*$/, '').trim();
  if (!trimmed) throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Mind map output was empty');

  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  if (!lines[0]!.startsWith('# ')) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Mind map output must start with a top-level heading');
  }
  if (lines.length < 2) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Mind map output must contain at least one node');
  }
  const body = lines.slice(1);
  if (!body.every((l) => /^(\s*)-\s+\S/.test(l))) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Mind map output must be a Markdown bullet outline');
  }
  if (lines.length > 200) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Mind map output is too large');
  }
  return lines.join('\n');
}

/** A transcript must be non-trivial text before downstream stages run. */
export function validateTranscript(text: string, provider: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 1) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Transcript was empty');
  }
  return trimmed;
}

/** A summary must be Markdown with real content. */
export function validateSummary(text: string, provider: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Summary was too short to be valid');
  }
  if (trimmed.length > 40_000) {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Summary exceeded the maximum length');
  }
  return trimmed;
}
