// src/__tests__/api/generate-scene-image.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FACE_VISIBLE, FACE_CROPPED, MODEL_KO, POSE_STATIC } from '@/app/api/ai/generate-scene-image/prompts';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockLoadReferenceImages = vi.fn();
vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: (...args: unknown[]) => mockLoadReferenceImages(...args),
}));

const mockGenerateFrameImage = vi.fn();
vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: (...args: unknown[]) => mockGenerateFrameImage(...args),
}));

const mockClaudeCreate = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: () => ({ messages: { create: mockClaudeCreate } }),
}));

import { POST } from '@/app/api/ai/generate-scene-image/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-scene-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaudeCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ prompt: 'a detailed scene prompt' }) }],
  });
  mockGenerateFrameImage.mockResolvedValue({ imageBase64: 'GEN', mimeType: 'image/png' });
});

describe('POST /api/ai/generate-scene-image — 멀티참조', () => {
  it('productImageUrls 3장이 Claude content와 generateFrameImage에 모두 전달된다', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        sectionType: 'hero',
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const claudeArgs = mockClaudeCreate.mock.calls[0][0];
    const userContent = claudeArgs.messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(3);

    expect(mockGenerateFrameImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          { base64: 'A', mimeType: 'image/jpeg' },
          { base64: 'B', mimeType: 'image/jpeg' },
          { base64: 'C', mimeType: 'image/jpeg' },
        ],
      }),
    );
  });

  it('참조 0장이면 이미지 블록 없이 텍스트만으로 생성한다', async () => {
    mockLoadReferenceImages.mockResolvedValue([]);

    const res = await POST(makeRequest({ sectionType: 'lifestyle' }));
    expect(res.status).toBe(200);

    const userContent = mockClaudeCreate.mock.calls[0][0].messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('잘못된 sectionType은 400을 반환한다', async () => {
    const res = await POST(makeRequest({ sectionType: 'banner' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ai/generate-scene-image — wearing', () => {
  beforeEach(() => {
    mockLoadReferenceImages.mockResolvedValue([]);
  });

  it('옵션을 생략하면 기본값(얼굴 노출·male)이 적용된다', async () => {
    const res = await POST(makeRequest({ sectionType: 'wearing' }));
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).toContain(FACE_VISIBLE);
    expect(imagePrompt).toContain(MODEL_KO.male);
  });

  it('인물 지시가 정확히 한 번만 들어간다', async () => {
    const res = await POST(makeRequest({ sectionType: 'wearing' }));
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt.indexOf(POSE_STATIC)).toBe(imagePrompt.lastIndexOf(POSE_STATIC));
    expect(imagePrompt.indexOf(POSE_STATIC)).toBeGreaterThan(-1);
  });

  it('Claude 프롬프트 뒤에 붙는다 (앞이 아니다)', async () => {
    const res = await POST(makeRequest({ sectionType: 'wearing' }));
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    // beforeEach의 mockClaudeCreate 기본 응답: { prompt: 'a detailed scene prompt' }
    expect(imagePrompt.startsWith('a detailed scene prompt')).toBe(true);
  });

  it('faceVisible: false면 FACE_CROPPED가 들어가고 FACE_VISIBLE은 없다', async () => {
    const res = await POST(
      makeRequest({ sectionType: 'wearing', wearing: { faceVisible: false } }),
    );
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).toContain(FACE_CROPPED);
    expect(imagePrompt).not.toContain(FACE_VISIBLE);
  });

  it('hero에는 인물 지시(POSE_STATIC)가 들어가지 않는다', async () => {
    const res = await POST(makeRequest({ sectionType: 'hero' }));
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).not.toContain(POSE_STATIC);
  });

  it('scenePrompt 직결 경로에서도 Claude 호출 없이 인물 지시가 정확히 한 번 들어간다', async () => {
    const res = await POST(
      makeRequest({ sectionType: 'wearing', scenePrompt: '해변을 걷는 모습' }),
    );
    expect(res.status).toBe(200);

    expect(mockClaudeCreate).not.toHaveBeenCalled();

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt.indexOf(POSE_STATIC)).toBe(imagePrompt.lastIndexOf(POSE_STATIC));
    expect(imagePrompt.indexOf(POSE_STATIC)).toBeGreaterThan(-1);
  });
});
