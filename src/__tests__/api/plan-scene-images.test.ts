import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockCallClaude = vi.fn();
vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}));

import { POST } from '@/app/api/ai/plan-scene-images/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/plan-scene-images', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_BODY = { productName: '에어팟', category: 'basic', imageCount: 2, sceneCount: 2 };
const MOCK_SCENES = [
  { title: '전면샷', description: '제품 정면', prompt: 'Studio product shot on white background...', suggestedImageIndex: 0 },
  { title: '라이프스타일', description: '일상 사용', prompt: 'Lifestyle scene with warm natural light...', suggestedImageIndex: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCallClaude.mockResolvedValue(JSON.stringify({ scenes: MOCK_SCENES }));
});

describe('POST /api/ai/plan-scene-images', () => {
  it('정상 요청 시 scenes 배열 반환', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.scenes).toHaveLength(2);
    expect(json.scenes[0].title).toBe('전면샷');
  });

  it('Claude가 ```json 코드블록으로 감싸 반환해도 파싱 성공', async () => {
    mockCallClaude.mockResolvedValue('```json\n' + JSON.stringify({ scenes: MOCK_SCENES }) + '\n```');
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scenes).toHaveLength(2);
  });

  it('suggestedImageIndex가 imageCount 범위를 초과하면 imageCount-1로 클램핑', async () => {
    const overflowScenes = [{ ...MOCK_SCENES[0], suggestedImageIndex: 99 }];
    mockCallClaude.mockResolvedValue(JSON.stringify({ scenes: overflowScenes }));
    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();
    expect(json.scenes[0].suggestedImageIndex).toBe(1); // imageCount-1 = 1
  });

  it('productName 없으면 400', async () => {
    const res = await POST(makeRequest({ category: 'basic', imageCount: 1 }));
    expect(res.status).toBe(400);
  });

  it('callClaude 실패 시 500', async () => {
    mockCallClaude.mockRejectedValue(new Error('network error'));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });

  it('brandName 포함 시 callClaude에 브랜드명이 전달된다', async () => {
    await POST(makeRequest({ ...VALID_BODY, brandName: '애플' }));
    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('애플'),
      'sonnet',
      2048,
    );
  });
});
