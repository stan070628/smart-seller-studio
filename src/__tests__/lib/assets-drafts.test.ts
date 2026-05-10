import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  getAssetsDrafts,
  saveAssetsDraft,
  deleteAssetsDraft,
  type AssetsDraftMeta,
} from '@/lib/listing/assets-drafts';

const mockDraft: AssetsDraftMeta = {
  id: 'draft-1',
  name: '작업1',
  draftData: { mode: 'url', url: 'https://example.com' },
  createdAt: '2026-05-10T00:00:00.000Z',
};

describe('getAssetsDrafts', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/listing/assets/drafts', () =>
        HttpResponse.json({ drafts: [mockDraft] }),
      ),
    );
  });

  it('임시저장 목록을 반환한다', async () => {
    const result = await getAssetsDrafts();
    expect(result).toEqual([mockDraft]);
  });

  it('서버 에러 시 빈 배열을 반환한다', async () => {
    server.use(
      http.get('/api/listing/assets/drafts', () =>
        HttpResponse.json({ error: 'DB error' }, { status: 500 }),
      ),
    );
    const result = await getAssetsDrafts();
    expect(result).toEqual([]);
  });

  it('401 시 빈 배열을 반환한다', async () => {
    server.use(
      http.get('/api/listing/assets/drafts', () =>
        HttpResponse.json({ error: '인증 필요' }, { status: 401 }),
      ),
    );
    const result = await getAssetsDrafts();
    expect(result).toEqual([]);
  });
});

describe('saveAssetsDraft', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/listing/assets/drafts', () =>
        HttpResponse.json({ id: 'draft-1' }, { status: 201 }),
      ),
    );
  });

  it('저장 후 AssetsDraftMeta를 반환한다', async () => {
    const result = await saveAssetsDraft('작업1', { mode: 'url' });
    expect(result.id).toBe('draft-1');
    expect(result.name).toBe('작업1');
    expect(result.draftData).toEqual({ mode: 'url' });
  });

  it('서버 에러 시 에러를 던진다', async () => {
    server.use(
      http.post('/api/listing/assets/drafts', () =>
        HttpResponse.json({ error: '저장 실패' }, { status: 500 }),
      ),
    );
    await expect(saveAssetsDraft('작업1', {})).rejects.toThrow('저장 실패');
  });
});

describe('deleteAssetsDraft', () => {
  beforeEach(() => {
    server.use(
      http.delete('/api/listing/assets/drafts/:id', () =>
        HttpResponse.json({ success: true }),
      ),
    );
  });

  it('삭제 요청 시 에러 없이 완료된다', async () => {
    await expect(deleteAssetsDraft('draft-1')).resolves.not.toThrow();
  });

  it('서버 에러 시 에러를 던진다', async () => {
    server.use(
      http.delete('/api/listing/assets/drafts/:id', () =>
        HttpResponse.json({ error: '삭제 실패' }, { status: 500 }),
      ),
    );
    await expect(deleteAssetsDraft('draft-1')).rejects.toThrow('삭제 실패');
  });
});
