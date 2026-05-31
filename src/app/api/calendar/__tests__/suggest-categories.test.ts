import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));

import { callClaude } from '@/lib/ai/claude-cli';
import { POST } from '../suggest-categories/route';

const MOCK_RESPONSE = JSON.stringify([
  {
    name: '반려동물용품',
    subcategories: ['강아지 간식', '고양이 장난감', '펫 침대', '반려동물 의류', '반려동물 목욕용품'],
  },
  {
    name: '유아용품',
    subcategories: ['아기 장난감', '유아 의류', '아기 목욕용품', '아기 침구', '유아 식기'],
  },
]);

describe('POST /api/calendar/suggest-categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeReq(body: unknown) {
    return new NextRequest('http://localhost/api/calendar/suggest-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('currentCategories 없으면 400 반환', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('currentCategories 빈 배열이면 400 반환', async () => {
    const res = await POST(makeReq({ currentCategories: [] }));
    expect(res.status).toBe(400);
  });

  it('callClaude 정상 응답 시 대분류+소분류 트리 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RESPONSE);

    const res = await POST(makeReq({ currentCategories: ['잡화', '뷰티/위생'] }));
    expect(res.status).toBe(200);
    const data = await res.json() as {
      categories: { id: string; name: string; subcategories: { id: string; name: string }[] }[];
      suggestedAt: string;
    };
    expect(data.categories.length).toBeGreaterThanOrEqual(1);
    expect(data.categories[0]).toHaveProperty('id');
    expect(data.categories[0]).toHaveProperty('name');
    expect(data.categories[0].subcategories.length).toBeGreaterThan(0);
    expect(data.categories[0].subcategories[0]).toHaveProperty('id');
    expect(data.categories[0].subcategories[0]).toHaveProperty('name');
    expect(data.suggestedAt).toBeDefined();
  });

  it('callClaude throw 시 500 반환 — 교체 없음', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('CLI 실패'));

    const res = await POST(makeReq({ currentCategories: ['잡화'] }));
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('JSON 파싱 실패 시 500 반환', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue('올바른 JSON이 아닙니다');

    const res = await POST(makeReq({ currentCategories: ['잡화'] }));
    expect(res.status).toBe(500);
  });

  it('요청 바디가 JSON 아니면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/calendar/suggest-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
