/** Browser-side API helper. Same-origin only — cookies are sent automatically. */

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (json as { error?: ApiError } | null)?.error ?? { code: 'UNKNOWN', message: response.statusText };
    throw new ApiClientError(response.status, error);
  }
  return (json as { data: T }).data;
}

export async function apiUpload<T>(file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/notes/upload', { method: 'POST', body: form, credentials: 'same-origin' });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (json as { error?: ApiError } | null)?.error ?? { code: 'UNKNOWN', message: response.statusText };
    throw new ApiClientError(response.status, error);
  }
  return (json as { data: T }).data;
}
