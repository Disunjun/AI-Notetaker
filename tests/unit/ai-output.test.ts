import { describe, expect, it } from 'vitest';
import {
  extractJsonObject,
  parseActionItems,
  validateMindMapMarkdown,
  validateSummary,
  validateTranscript,
  MAX_ACTION_ITEMS,
} from '@/lib/ai/output';
import { ErrorCode } from '@/lib/errors';

describe('action item parsing', () => {
  it('parses a well-formed response', () => {
    const items = parseActionItems(
      JSON.stringify({ actionItems: [{ content: 'Send the deck', assignee: 'Ada', dueDate: '2026-09-10' }] }),
      'p',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ content: 'Send the deck', assignee: 'Ada', dueDate: '2026-09-10' });
  });

  it('tolerates markdown code fences around the JSON', () => {
    const items = parseActionItems('```json\n{"actionItems":[{"content":"Follow up"}]}\n```', 'p');
    expect(items[0]!.content).toBe('Follow up');
  });

  it('tolerates prose around the JSON object', () => {
    const items = parseActionItems('Sure! Here you go:\n{"actionItems":[{"content":"Call vendor"}]}\nHope that helps.', 'p');
    expect(items[0]!.content).toBe('Call vendor');
  });

  it('accepts an empty list', () => {
    expect(parseActionItems('{"actionItems":[]}', 'p')).toEqual([]);
  });

  it('drops entries with no usable content', () => {
    const items = parseActionItems(
      JSON.stringify({ actionItems: [{ content: '' }, { content: '   ' }, { assignee: 'nobody' }, { content: 'Real task' }] }),
      'p',
    );
    expect(items.map((i) => i.content)).toEqual(['Real task']);
  });

  it('normalises null assignee and due date', () => {
    const items = parseActionItems(JSON.stringify({ actionItems: [{ content: 'x' }] }), 'p');
    expect(items[0]).toEqual({ content: 'x', assignee: null, dueDate: null });
  });

  it('rejects a due date that is not ISO-like', () => {
    const items = parseActionItems(JSON.stringify({ actionItems: [{ content: 'x', dueDate: 'next tuesday' }] }), 'p');
    expect(items[0]!.dueDate).toBeNull();
  });

  it('caps the number of action items', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ content: `task ${i}` }));
    expect(parseActionItems(JSON.stringify({ actionItems: many }), 'p')).toHaveLength(MAX_ACTION_ITEMS);
  });

  it('truncates an over-long content string', () => {
    const items = parseActionItems(JSON.stringify({ actionItems: [{ content: 'a'.repeat(5000) }] }), 'p');
    expect(items[0]!.content.length).toBe(1000);
  });

  it('raises a PERMANENT AI_RESPONSE_INVALID error on non-JSON', () => {
    expect(() => parseActionItems('no json here', 'p')).toThrowError(expect.objectContaining({ code: ErrorCode.AI_RESPONSE_INVALID }));
  });

  it('raises a PERMANENT error when actionItems is missing', () => {
    expect(() => parseActionItems('{"items":[]}', 'p')).toThrowError(expect.objectContaining({ code: ErrorCode.AI_RESPONSE_INVALID }));
  });
});

describe('JSON extraction', () => {
  it('extracts the outermost object', () => {
    expect(extractJsonObject('noise {"a":{"b":1}} noise')).toBe('{"a":{"b":1}}');
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('nothing')).toThrow();
  });
});

describe('mind map validation', () => {
  const valid = '# Meeting\n- Topic\n  - Detail';

  it('accepts a heading plus nested bullets', () => {
    expect(validateMindMapMarkdown(valid, 'p')).toBe(valid);
  });

  it('strips markdown fences', () => {
    expect(validateMindMapMarkdown('```markdown\n# M\n- a\n```', 'p')).toBe('# M\n- a');
  });

  it('rejects output with no top-level heading', () => {
    expect(() => validateMindMapMarkdown('- a\n- b', 'p')).toThrowError(
      expect.objectContaining({ code: ErrorCode.AI_RESPONSE_INVALID }),
    );
  });

  it('rejects a heading with no nodes', () => {
    expect(() => validateMindMapMarkdown('# Only a title', 'p')).toThrow();
  });

  it('rejects prose mixed into the outline', () => {
    expect(() => validateMindMapMarkdown('# M\n- a\nSome prose here', 'p')).toThrow();
  });

  it('rejects empty output', () => {
    expect(() => validateMindMapMarkdown('   ', 'p')).toThrow();
  });

  it('rejects an oversized outline', () => {
    const huge = '# M\n' + Array.from({ length: 300 }, (_, i) => `- node ${i}`).join('\n');
    expect(() => validateMindMapMarkdown(huge, 'p')).toThrow();
  });
});

describe('transcript and summary validation', () => {
  it('accepts a real transcript and trims it', () => {
    expect(validateTranscript('  hello there  ', 'p')).toBe('hello there');
  });

  it('rejects an empty transcript', () => {
    expect(() => validateTranscript('   ', 'p')).toThrowError(expect.objectContaining({ code: ErrorCode.AI_RESPONSE_INVALID }));
  });

  it('rejects a summary that is too short to be real', () => {
    expect(() => validateSummary('tiny', 'p')).toThrow();
  });

  it('accepts a plausible summary', () => {
    expect(validateSummary('## Overview\nThe team agreed to ship on Friday.', 'p')).toContain('Overview');
  });

  it('rejects an over-long summary', () => {
    expect(() => validateSummary('a'.repeat(50_000), 'p')).toThrow();
  });
});
