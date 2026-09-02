import { describe, expect, it } from 'vitest';
import { estimateTokenCost, estimateTranscriptionCost, rateFor, round6, totalCost, type UsageBreakdown } from '@/lib/usage/estimate';

describe('estimated cost', () => {
  it('computes token cost from the per-1k rates', () => {
    const rate = rateFor('gpt-4o-mini');
    const cost = estimateTokenCost('gpt-4o-mini', 1000, 1000);
    expect(cost).toBeCloseTo(rate.inputPer1k + rate.outputPer1k, 10);
  });

  it('falls back to a sane default rate for an unknown model', () => {
    expect(estimateTokenCost('some-unknown-model', 1000, 1000)).toBeGreaterThan(0);
  });

  it('charges transcription per minute of audio', () => {
    expect(estimateTranscriptionCost('whisper-large-v3', 60)).toBeCloseTo(0.006, 10);
    expect(estimateTranscriptionCost('whisper-large-v3', 120)).toBeCloseTo(0.012, 10);
    expect(estimateTranscriptionCost('whisper-large-v3', 0)).toBe(0);
  });

  it('sums every stage plus transcription', () => {
    const breakdown: UsageBreakdown = {
      transcription: { model: 'whisper-large-v3', audioSeconds: 60, cost: 0.006 },
      text: [
        { stage: 'SUMMARY', model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500, cost: 0.00045 },
        { stage: 'ACTION_ITEMS', model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 200, cost: 0.00027 },
      ],
    };
    expect(totalCost(breakdown)).toBeCloseTo(0.006 + 0.00045 + 0.00027, 10);
  });

  it('handles a job with no transcription entry', () => {
    const breakdown: UsageBreakdown = {
      transcription: null,
      text: [{ stage: 'SUMMARY', model: 'gpt-4o', promptTokens: 100, completionTokens: 100, cost: 0.00125 }],
    };
    expect(totalCost(breakdown)).toBeCloseTo(0.00125, 10);
  });

  it('rounds to 6 decimal places so Decimal storage is stable', () => {
    expect(round6(0.1234567891)).toBe(0.123457);
    expect(round6(0)).toBe(0);
  });
});
