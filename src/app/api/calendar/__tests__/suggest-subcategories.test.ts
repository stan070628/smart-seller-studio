import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));

import { callClaude } from '@/lib/ai/claude-cli';
import { POST } from '../suggest-subcategories/route';

describe('POST /api/calendar/suggest-subcategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeReq(body: unknown) {
    return new NextRequest('http://localhost/api/calendar/suggest-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('parentCategory 없으면 400 반환', async () => {
    const res = await POST(makeReq({ currentSubcategories: [] }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('callClaude 정상 응답 시 소분류 배열 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(
      '["보온병", "캠핑컵", "스포츠 텀블러", "아이스 텀블러", "소형 텀블러", "이중 텀블러"]',
    );

    const res = await POST(makeReq({
      parentCategory: '잡화',
      currentSubcategories: ['텀블러', '머그컵'],
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[]; suggestedAt: string };
    expect(data.subcategories.length).toBeGreaterThanOrEqual(1);
    expect(data.subcategories[0]).toHaveProperty('id');
    expect(data.subcategories[0]).toHaveProperty('name');
    expect(data.suggestedAt).toBeDefined();
  });

  it('callClaude throw 시 폴백 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ANTHROPIC_API_KEY 미설정'),
    );

    const res = await POST(makeReq({ parentCategory: '잡화', currentSubcategories: [] }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[] };
    expect(data.subcategories.length).toBeGreaterThan(0);
    expect(data.subcategories[0].name).toContain('잡화');
  });

  it('callClaude 네트워크 오류 시 폴백 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('네트워크 오류'));

    const res = await POST(makeReq({ parentCategory: '잡화', currentSubcategories: [] }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[] };
    expect(data.subcategories.length).toBeGreaterThan(0);
  });

  it('요청 바디가 JSON 아니면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/calendar/suggest-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
