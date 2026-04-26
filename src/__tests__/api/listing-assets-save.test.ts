import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
const supabaseMock = {
  from: vi.fn(() => ({
    insert: insertMock,
  })),
};

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: () => supabaseMock,
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-1' })),
}));

import { POST } from '@/app/api/listing/assets/save/route';

function makeReq(body: object) {
  return new Request('http://localhost/api/listing/assets/save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/listing/assets/save', () => {
  beforeEach(() => {
    insertMock.mockReset();
    supabaseMock.from.mockClear();
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'uuid-x' }, error: null }) }),
    });
  });

  it('필수 필드가 빠지면 400을 반환한다', async () => {
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('thumbnails가 없으면 400을 반환한다', async () => {
    const res = await POST(makeReq({
      sourceType: 'url',
      sourceUrl: 'https://x.com',
      // thumbnails 없음
      detailHtml: '<div></div>',
    }) as never);
    expect(res.status).toBe(400);
  });

  it('성공 시 generated_assets에 insert하고 id를 반환한다', async () => {
    const res = await POST(makeReq({
      sourceType: 'url',
      sourceUrl: 'https://x.com',
      thumbnails: ['t1.jpg'],
      detailHtml: '<div></div>',
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('uuid-x');
    expect(supabaseMock.from).toHaveBeenCalledWith('generated_assets');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      source_type: 'url',
      source_url: 'https://x.com',
      thumbnails: ['t1.jpg'],
      detail_html: '<div></div>',
    }));
  });
});
