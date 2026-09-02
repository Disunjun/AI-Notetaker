import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import {
  AiCallError,
  errorFromHttpStatus,
  isTimeoutError,
  permanentError,
  transientError,
  type AIProvider,
  type GenerateTextInput,
  type GenerateTextResult,
  type TranscribeInput,
  type TranscribeResult,
} from '@/lib/ai/types';
import { ErrorCode, FailureKind } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * OpenAI-compatible provider.
 *
 * Covers OpenAI itself, Groq, and any endpoint exposing the same
 * `/audio/transcriptions`, `/chat/completions` and `/models` surface.
 */

export const DEFAULT_BASE_URLS: Record<string, string> = {
  OPENAI: 'https://api.openai.com/v1',
  GROQ: 'https://api.groq.com/openai/v1',
};

export interface OpenAiCompatibleOptions {
  name: string;
  type: string;
  role: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs: number;
}

function resolveBaseUrl(type: string, baseUrl?: string | null): string {
  if (baseUrl && baseUrl.trim()) return baseUrl.trim().replace(/\/+$/, '');
  const known = DEFAULT_BASE_URLS[type];
  if (!known) {
    throw new AiCallError({
      code: ErrorCode.AI_PROVIDER_INVALID_REQUEST,
      message: 'baseUrl is required for OPENAI_COMPATIBLE providers',
      kind: FailureKind.PERMANENT,
      provider: 'config',
    });
  }
  return known;
}

async function readJsonResponse(response: Response, provider: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw errorFromHttpStatus(provider, response.status, text.slice(0, 300));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned non-JSON body');
  }
}

export class OpenAiCompatibleProvider implements AIProvider {
  readonly name: string;
  readonly type: string;
  readonly role: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.type = options.type;
    this.role = options.role;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseUrl = resolveBaseUrl(options.type, options.baseUrl);
    this.timeoutMs = options.timeoutMs;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // The API key is only ever placed in a request header; it is never logged.
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  private async request(path: string, init: RequestInit, provider: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw transientError(provider, ErrorCode.AI_PROVIDER_TIMEOUT, `Provider request timed out after ${this.timeoutMs}ms`, error);
      }
      throw transientError(provider, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'Provider network error', error);
    }
  }

  async testConnection(): Promise<void> {
    await this.listModels();
  }

  async listModels(): Promise<string[]> {
    const provider = this.name;
    const response = await this.request('/models', { method: 'GET' }, provider);
    const body = (await readJsonResponse(response, provider)) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(body.data)
      ? body.data.map((m) => m?.id).filter((id): id is string => typeof id === 'string')
      : [];
    if (models.length === 0) throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no models');
    return models;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const provider = this.name;
    // The file is read once and held only for the duration of the call.
    const stream = createReadStream(input.filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength === 0) {
      throw permanentError(provider, ErrorCode.UPLOAD_EMPTY, 'Audio file is empty');
    }

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: input.mimeType }), basename(input.fileName));
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');

    const response = await this.request('/audio/transcriptions', { method: 'POST', body: form }, provider);
    const body = (await readJsonResponse(response, provider)) as { text?: unknown; language?: unknown };

    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned an empty transcript');
    }
    logger.debug('ai_transcribe_ok', { provider, model: this.model, characters: body.text.length });
    return {
      text: body.text,
      language: typeof body.language === 'string' ? body.language : null,
      provider,
      model: this.model,
      audioSeconds: null,
    };
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const provider = this.name;
    const payload: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
      temperature: input.temperature ?? 0.2,
    };
    if (input.maxTokens) payload.max_tokens = input.maxTokens;
    if (input.responseFormat === 'json') payload.response_format = { type: 'json_object' };

    const response = await this.request(
      '/chat/completions',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      provider,
    );
    const body = (await readJsonResponse(response, provider)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw permanentError(provider, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no completion text');
    }

    return {
      text: content,
      provider,
      model: this.model,
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
        totalTokens: body.usage?.total_tokens ?? 0,
      },
    };
  }
}
