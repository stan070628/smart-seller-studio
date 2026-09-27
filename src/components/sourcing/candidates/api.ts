'use client';

import { readJsonOrThrow } from '@/lib/receipt/http';
import type { ListingView } from '@/lib/sourcing-candidates/view';

type Res<T> = { success: boolean; data?: T; error?: string };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const body = await readJsonOrThrow<Res<T>>(await fetch(input, init));
  if (!body.success) throw new Error(body.error ?? '요청 실패');
  return body.data as T;
}

function form(files: File[], extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return fd;
}

const json = (data: unknown): RequestInit => ({
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

export interface ScanSummary {
  id: string; category_path: string | null; sort_label: string | null;
  parse_status: string; parse_error: string | null; created_at: string;
  listing_count: number; starred_count: number;
}

export const api = {
  listScans: () => call<ScanSummary[]>('/api/sourcing-candidates/scans'),
  uploadScan: (files: File[]) => call<{ id: string }>('/api/sourcing-candidates/scans', { method: 'POST', body: form(files) }),
  parseScan: (id: string) =>
    call<{ listing_count: number; partial_error: string | null }>(`/api/sourcing-candidates/scans/${id}/parse`, { method: 'POST' }),
  listings: (q: { scan?: string; starred?: boolean }) =>
    call<ListingView[]>(`/api/sourcing-candidates/listings?${q.scan ? `scan=${q.scan}` : 'starred=1'}`),
  patchListing: (id: string, data: Record<string, unknown>) => call<void>(`/api/sourcing-candidates/listings/${id}`, json(data)),
  addOffer: (listingId: string, files: File[], url: string) =>
    call<{ id: string; parse_error: string | null }>(`/api/sourcing-candidates/listings/${listingId}/offers`, {
      method: 'POST', body: form(files, url ? { url } : {}),
    }),
  patchOffer: (id: string, data: Record<string, unknown>) => call<void>(`/api/sourcing-candidates/offers/${id}`, json(data)),
  reparseOffer: (id: string) => call<void>(`/api/sourcing-candidates/offers/${id}/parse`, { method: 'POST' }),
};
