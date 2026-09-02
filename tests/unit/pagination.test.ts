import { describe, expect, it } from 'vitest';
import { buildPage, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePagination, skipFor } from '@/lib/pagination';

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('bounded pagination', () => {
  it('defaults to page 1 and the default page size', () => {
    expect(parsePagination(params(''))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('clamps page size to the maximum so a client cannot dump the table', () => {
    expect(parsePagination(params('pageSize=100000')).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsePagination(params(`pageSize=${MAX_PAGE_SIZE + 1}`)).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('ignores invalid or non-positive values', () => {
    expect(parsePagination(params('page=-5&pageSize=0'))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePagination(params('page=abc&pageSize=xyz'))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('caps the page number', () => {
    expect(parsePagination(params('page=999999')).page).toBe(10_000);
  });

  it('computes the offset from the page request', () => {
    expect(skipFor({ page: 1, pageSize: 20 })).toBe(0);
    expect(skipFor({ page: 3, pageSize: 20 })).toBe(40);
  });

  it('builds a page envelope with at least one page', () => {
    const page = buildPage(['a', 'b'], 2, { page: 1, pageSize: 20 });
    expect(page).toEqual({ items: ['a', 'b'], page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('computes total pages by rounding up', () => {
    expect(buildPage([], 41, { page: 1, pageSize: 20 }).totalPages).toBe(3);
  });
});
