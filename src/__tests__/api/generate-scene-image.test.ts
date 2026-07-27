// src/__tests__/api/generate-scene-image.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PERSON_QUALITY, PRODUCT_FIDELITY_INSTRUCTION, POSE_STATIC } from '@/app/api/ai/generate-scene-image/prompts';

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

  it('제거된 wearing sectionType은 400을 반환한다', async () => {
    // model_wearing 전용 경로를 접었으므로 enum에서 빠졌다 — 실수로 되살아나지
    // 않게 회귀를 고정한다.
    const res = await POST(makeRequest({ sectionType: 'wearing' }));
    expect(res.status).toBe(400);
  });
});

// 인물 품질 조건절(PERSON_QUALITY)이 sectionType과 무관하게 모든 씬에 도달하는지 —
// model_wearing 전용 경로를 접은 이번 리버설의 핵심 검증이다.
describe('POST /api/ai/generate-scene-image — 인물 품질 조건절', () => {
  beforeEach(() => {
    mockLoadReferenceImages.mockResolvedValue([]);
  });

  it('scenePrompt 직결 경로(hero): Claude 호출 없이도 PRODUCT_FIDELITY_INSTRUCTION이 붙어 인물 조건절이 들어간다', async () => {
    // COMPOSITE_SECTIONS에 hero가 없고 productRefs가 비어 있어 compositeProductPng는
    // 항상 null이다 → route.ts가 `${directPrompt}\n\n${PRODUCT_FIDELITY_INSTRUCTION}`을
    // 코드 레벨에서 무조건 붙인다(Claude를 거치지 않아도 보장됨).
    const res = await POST(
      makeRequest({ sectionType: 'hero', scenePrompt: '스튜디오 제품 샷' }),
    );
    expect(res.status).toBe(200);
    expect(mockClaudeCreate).not.toHaveBeenCalled();

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).toContain(PRODUCT_FIDELITY_INSTRUCTION);
    expect(imagePrompt).toContain(PERSON_QUALITY);
    expect(imagePrompt).toContain(POSE_STATIC);
  });

  it('scenePrompt 직결 경로(lifestyle, 제품 참조 없음): 같은 방식으로 인물 조건절이 들어간다', async () => {
    const res = await POST(
      makeRequest({ sectionType: 'lifestyle', scenePrompt: '카페에서 사용하는 장면' }),
    );
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).toContain(PERSON_QUALITY);
  });

  it('Claude 경로(hero): Claude가 SCENE_PROMPT_SYSTEM 지시대로 PRODUCT_FIDELITY_INSTRUCTION으로 끝내면 그대로 전달된다', async () => {
    // 실제 Claude는 SCENE_PROMPT_SYSTEM의 "MUST end with this exact instruction"에
    // 따라 PRODUCT_FIDELITY_INSTRUCTION을 프롬프트 끝에 포함한다 — 그 문구를
    // 모킹해 route.ts가 이를 그대로 finalScenePrompt로 넘기는지 확인한다.
    mockClaudeCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({ prompt: `a dramatic studio scene. ${PRODUCT_FIDELITY_INSTRUCTION}` }),
      }],
    });

    const res = await POST(makeRequest({ sectionType: 'hero' }));
    expect(res.status).toBe(200);

    const imagePrompt = mockGenerateFrameImage.mock.calls[0][0].imagePrompt as string;
    expect(imagePrompt).toContain(PERSON_QUALITY);
  });
});
