/**
 * analyze-image.test.ts
 * POST /api/ai/analyze-image Route Handler 단위 테스트
 *
 * 실제 구현: src/app/api/ai/analyze-image/route.ts
 * 의존성: @/lib/ai/gemini → analyzeProductImage 를 vi.mock으로 대체
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Gemini 모듈 Mock (실제 API 호출 방지)
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/gemini', () => ({
  analyzeProductImage: vi.fn(),
}));

import { analyzeProductImage } from '@/lib/ai/gemini';
import { POST } from '@/app/api/ai/analyze-image/route';

// 타입 단언 (vi.fn() 타입 추론용)
const mockAnalyzeImage = analyzeProductImage as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 성공 응답 픽스처
// ---------------------------------------------------------------------------

const MOCK_IMAGE_OUTPUT = {
  material: '이중벽 구조의 스테인리스 스틸 소재로 무광 마감 처리되어 있습니다',
  shape: '원통형 텀블러 형태로 뚜껑이 일체형이며 하단이 넓어 안정적입니다',
  colors: ['무광 블랙', '실버'],
  keyComponents: ['이중벽 진공 단열 구조', '실리콘 그립 밴드', '원터치 잠금 뚜껑'],
  visualPrompt:
    'A cinematic slow-motion shot of a matte black stainless steel tumbler --ar 9:16',
};

/** 작은 유효 base64 문자열 (실제 이미지 데이터가 아니어도 검증 통과용) */
const VALID_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/ai/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/ai/analyze-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('정상: 유효한 imageBase64 + "image/jpeg" → 200 + 분석 결과 반환', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(MOCK_IMAGE_OUTPUT);

    const request = makeRequest({
      imageBase64: VALID_BASE64,
      mimeType: 'image/jpeg',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      material: expect.any(String),
      shape: expect.any(String),
      colors: expect.any(Array),
      keyComponents: expect.any(Array),
      visualPrompt: expect.any(String),
    });
    expect(mockAnalyzeImage).toHaveBeenCalledOnce();
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('imageBase64 누락 → 400', async () => {
    const request = makeRequest({ mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('imageBase64');
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('imageBase64 빈 문자열 → 400', async () => {
    const request = makeRequest({ imageBase64: '', mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('imageBase64');
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('data URL prefix 포함(data:image/png;base64,...) → 정상 처리 (prefix 자동 제거)', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(MOCK_IMAGE_OUTPUT);

    const dataUrl = `data:image/png;base64,${VALID_BASE64}`;
    const request = makeRequest({ imageBase64: dataUrl, mimeType: 'image/png' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // prefix가 제거된 순수 base64가 전달되어야 함
    expect(mockAnalyzeImage).toHaveBeenCalledWith({
      imageBase64: VALID_BASE64,
      mimeType: 'image/png',
    });
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('mimeType이 "image/gif" (허용 안 됨) → 400', async () => {
    const request = makeRequest({ imageBase64: VALID_BASE64, mimeType: 'image/gif' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('mimeType');
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('mimeType 누락 → 400', async () => {
    const request = makeRequest({ imageBase64: VALID_BASE64 });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('mimeType');
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  // ── 테스트 7 ──────────────────────────────────────────────────────────────
  it('imageBase64 크기 초과 (14MB 이상 base64 문자열) → 400 또는 413', async () => {
    // MAX_BASE64_LENGTH = 14 * 1024 * 1024 → 14MB 초과 문자열 생성
    const oversizedBase64 = 'A'.repeat(14 * 1024 * 1024 + 1);
    const request = makeRequest({ imageBase64: oversizedBase64, mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect([400, 413]).toContain(response.status);
    expect(json.success).toBe(false);
    expect(json.error).toContain('이미지 크기가 너무 큽니다');
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
  });

  // ── 테스트 8 ──────────────────────────────────────────────────────────────
  it('GOOGLE_AI_API_KEY 누락 에러 → 503', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(
      new Error('[Gemini] 환경변수 GOOGLE_AI_API_KEY가 설정되지 않았습니다.'),
    );

    const request = makeRequest({ imageBase64: VALID_BASE64, mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('AI API 키');
  });

  // ── 테스트 9 ──────────────────────────────────────────────────────────────
  it('Google AI RESOURCE_EXHAUSTED 에러 → 429', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(
      new Error('RESOURCE_EXHAUSTED: Quota exceeded for quota metric'),
    );

    const request = makeRequest({ imageBase64: VALID_BASE64, mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.success).toBe(false);
    expect(json.error).toContain('할당량');
  });

  // ── 테스트 10 ─────────────────────────────────────────────────────────────
  it('analyzeProductImage 일반 Error throw → 500', async () => {
    mockAnalyzeImage.mockRejectedValueOnce(new Error('알 수 없는 내부 오류 발생'));

    const request = makeRequest({ imageBase64: VALID_BASE64, mimeType: 'image/jpeg' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('알 수 없는 내부 오류 발생');
  });

  // ── 테스트 11 ─────────────────────────────────────────────────────────────
  it('비정상 JSON 바디 → 400', async () => {
    const request = new NextRequest('http://localhost:3000/api/ai/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {{{',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('JSON');
  });

  // ── 테스트 12 ─────────────────────────────────────────────────────────────
  it('analyzeProductImage 성공 시 반환값이 스키마에 맞게 응답됨 확인', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(MOCK_IMAGE_OUTPUT);

    const request = makeRequest({ imageBase64: VALID_BASE64, mimeType: 'image/webp' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // 스키마 필드 존재 확인
    expect(json.data).toHaveProperty('material');
    expect(json.data).toHaveProperty('shape');
    expect(json.data).toHaveProperty('colors');
    expect(json.data).toHaveProperty('keyComponents');
    expect(json.data).toHaveProperty('visualPrompt');
    // 타입 확인
    expect(typeof json.data.material).toBe('string');
    expect(typeof json.data.shape).toBe('string');
    expect(Array.isArray(json.data.colors)).toBe(true);
    expect(Array.isArray(json.data.keyComponents)).toBe(true);
    expect(typeof json.data.visualPrompt).toBe('string');
    // 실제 값 확인
    expect(json.data).toEqual(MOCK_IMAGE_OUTPUT);
  });
});
