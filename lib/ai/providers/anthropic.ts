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

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicOptions {
  name: string;
  role: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs: number;
}

/** Anthropic Claude provider (text generation only). */
export class AnthropicProvider implements AIProvider {
  readonly name: string;
  readonly type = 'ANTHROPIC';
  readonly role: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AnthropicOptions) {
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
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          ...(init.headers as Record<string, string> | undefined),
        },
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
    const response = await this.request('/models?limit=100', { method: 'GET' });
    const text = await response.text();
    if (!response.ok) throw errorFromHttpStatus(this.name, response.status, text.slice(0, 300));
    const body = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const models = (body.data ?? []).map((m) => m?.id).filter((id): id is string => typeof id === 'string');
    if (models.length === 0) throw permanentError(this.name, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no models');
    return models;
  }

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    throw unsupportedCapability(this.name, 'transcribe');
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const payload = {
      model: this.model,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0.2,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    };

    const response = await this.request('/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw errorFromHttpStatus(this.name, response.status, text.slice(0, 300));

    const parsed = JSON.parse(text) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = (parsed.content ?? [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (content.trim().length === 0) {
      throw permanentError(this.name, ErrorCode.AI_RESPONSE_INVALID, 'Provider returned no completion text');
    }

    return {
      text: content,
      provider: this.name,
      model: this.model,
      usage: {
        promptTokens: parsed.usage?.input_tokens ?? 0,
        completionTokens: parsed.usage?.output_tokens ?? 0,
        totalTokens: (parsed.usage?.input_tokens ?? 0) + (parsed.usage?.output_tokens ?? 0),
      },
    };
  }
}
