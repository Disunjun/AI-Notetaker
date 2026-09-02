/**
 * V1 usage estimation.
 *
 * Real per-request billing is not available for every provider, so cost is
 * estimated from published list prices. Rates are expressed in USD.
 */

export interface TokenRate {
  /** USD per 1,000 prompt tokens. */
  inputPer1k: number;
  /** USD per 1,000 completion tokens. */
  outputPer1k: number;
}

/** USD per 60 seconds of transcribed audio. */
export const TRANSCRIPTION_RATE_PER_MINUTE = 0.006;

const TOKEN_RATES: Record<string, TokenRate> = {
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4.1-mini': { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  'gpt-4.1': { inputPer1k: 0.002, outputPer1k: 0.008 },
  'llama-3.3-70b-versatile': { inputPer1k: 0.00059, outputPer1k: 0.00079 },
  'llama-3.1-8b-instant': { inputPer1k: 0.00005, outputPer1k: 0.00008 },
  'whisper-large-v3': { inputPer1k: 0, outputPer1k: 0 },
  'whisper-large-v3-turbo': { inputPer1k: 0, outputPer1k: 0 },
  'gemini-2.0-flash': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  'gemini-2.5-flash': { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  'claude-3-5-haiku-20241022': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'claude-sonnet-4-20250514': { inputPer1k: 0.003, outputPer1k: 0.015 },
};

const FALLBACK_RATE: TokenRate = { inputPer1k: 0.001, outputPer1k: 0.003 };

export function rateFor(model: string): TokenRate {
  return TOKEN_RATES[model] ?? FALLBACK_RATE;
}

export function estimateTokenCost(model: string, promptTokens: number, completionTokens: number): number {
  const rate = rateFor(model);
  return (promptTokens / 1000) * rate.inputPer1k + (completionTokens / 1000) * rate.outputPer1k;
}

export function estimateTranscriptionCost(model: string, audioSeconds: number): number {
  const rate = rateFor(model);
  if (rate.inputPer1k > 0 || rate.outputPer1k > 0) {
    // Token-priced transcription falls back to the per-minute rate.
    return (audioSeconds / 60) * TRANSCRIPTION_RATE_PER_MINUTE;
  }
  return (audioSeconds / 60) * TRANSCRIPTION_RATE_PER_MINUTE;
}

export interface UsageBreakdown {
  transcription: { model: string; audioSeconds: number; cost: number } | null;
  text: Array<{ stage: string; model: string; promptTokens: number; completionTokens: number; cost: number }>;
}

export function totalCost(breakdown: UsageBreakdown): number {
  const text = breakdown.text.reduce((sum, entry) => sum + entry.cost, 0);
  return round6(text + (breakdown.transcription?.cost ?? 0));
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
