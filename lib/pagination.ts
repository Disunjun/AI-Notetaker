import type { Paginated } from '@/types';

/** Bounded pagination — page size can never be used to exfiltrate the table. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface PageRequest {
  page: number;
  pageSize: number;
}

export function parsePagination(searchParams: URLSearchParams, defaults: { page?: number; pageSize?: number } = {}): PageRequest {
  const rawPage = Number.parseInt(searchParams.get('page') ?? '', 10);
  const rawSize = Number.parseInt(searchParams.get('pageSize') ?? '', 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : (defaults.page ?? 1);
  const requested = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : (defaults.pageSize ?? DEFAULT_PAGE_SIZE);

  return { page, pageSize: Math.min(requested, MAX_PAGE_SIZE) };
}

export function buildPage<T>(items: T[], total: number, request: PageRequest): Paginated<T> {
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
  };
}

export function skipFor(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}
