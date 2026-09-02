import {
  errorFromHttpStatus,
  isTimeoutError,
  permanentError,
  transientError,
  unsupportedCapability,
  type AIProvider,
  type GenerateTextInput,
  type GenerateTextResult,
  type TranscribeInput,
  type TranscribeResult,
} from '@/lib/ai/types';
import { ErrorCode } from '@/lib/errors';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GoogleOptions {
  name: string;
  role: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs: number;
}

/**
 * Google Gemini provider (text generation only).
 *
 * The API key is sent as the `x-goog-api-key` header rather than as a query
 * parameter so that it can never appear in a URL that might be logged.
 */
export class GoogleProvider implements AIProvider {
  readonly name: string;
  readonly type = 'GOOGLE';
  readonly role: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GoogleOptions) {
    this.name = options.name;
    this.role = options.role;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'x-goog-api-key': this.apiKey, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw transientError(this.name, ErrorCode.AI_PROVIDER_TIMEOUT, 'Provider request timed out', error);
      }
      throw transientError(this.name, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'Provider network error', error);
    }
  }

  async testConnection(): Promise<void> {
    await this.listModels();
  }

  async listModels(): Promise<string[]> {
    const response = await this.request('/models?pageSize=200', { method: 'GET' });
    const text = await response.text();
    if (!response.ok) throw errorFromHttpStatus(this.name, response.status, text.slice(0, 300));
    const body = JSON.parse(text) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? [])
      .map((m) => (typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : ''))
      .filter((m) => m.length > 0);
    if (models.length === 0) throw permanentError(this.name, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no models');
    return models;
  }

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    throw unsupportedCapability(this.name, 'transcribe');
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: {
        temperature: input.temperature ?? 0.2,
        ...(input.maxTokens ? { maxOutputTokens: input.maxTokens } : {}),
        ...(input.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const response = await this.request(`/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw errorFromHttpStatus(this.name, response.status, text.slice(0, 300));

    const parsed = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const content = parsed.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('') ?? '';
    if (content.trim().length === 0) {
      throw permanentError(this.name, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no completion text');
    }

    return {
      text: content,
      provider: this.name,
      model: this.model,
      usage: {
        promptTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: parsed.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }
}
