/**
 * generate-copy.test.ts
 * POST /api/ai/generate-copy Route Handler 단위 테스트
 *
 * 실제 구현: src/app/api/ai/generate-copy/route.ts
 * 의존성: @/lib/ai/claude → generateCopyFromReviews 를 vi.mock으로 대체
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Rate Limit Mock (429 차단 방지)
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 })),
  getRateLimitKey: vi.fn((ip: string, endpoint: string) => `${ip}:${endpoint}`),
  RATE_LIMITS: {
    AI_API: { windowMs: 60_000, maxRequests: 10 },
    UPLOAD: { windowMs: 60_000, maxRequests: 30 },
    RENDER: { windowMs: 60_000, maxRequests: 5 },
  },
}));

// ---------------------------------------------------------------------------
// Claude 모듈 Mock (실제 API 호출 방지)
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/claude', () => ({
  generateCopyFromReviews: vi.fn(),
}));

import { generateCopyFromReviews } from '@/lib/ai/claude';
import { POST } from '@/app/api/ai/generate-copy/route';

// 타입 단언 (vi.fn() 타입 추론용)
const mockGenerateCopy = generateCopyFromReviews as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 성공 응답 픽스처
// ---------------------------------------------------------------------------

const MOCK_COPY_OUTPUT = {
  sellingPoints: [
    '바람에도 뒤집히지 않는 역풍 대응 구조',
    '버튼 하나로 손 다침 없이 접히는 자동 개폐',
    '카라비너 고리로 가방에 바로 걸 수 있는 편의성',
  ] as [string, string, string],
  bubbleCopies: [
    '바람도 두렵지 않아',
    '양손이 자유로워요',
    '어디든 걸 수 있어',
  ] as [string, string, string],
  titles: [
    '강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용',
    '역풍 방지 자동 우산 카라비너 걸이 자동개폐 경량 방수',
    '자동 개폐 우산 강풍 카라비너 휴대 경량 방수 안전버튼',
  ] as [string, string, string],
};

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/ai/generate-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/ai/generate-copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정상 응답: 유효한 리뷰 배열 전송 시 200과 titles/bubbleCopies/sellingPoints 각 3개를 반환한다', async () => {
    mockGenerateCopy.mockResolvedValueOnce(MOCK_COPY_OUTPUT);

    const request = makeRequest({
      reviews: ['리뷰 첫 번째입니다.', '리뷰 두 번째입니다.', '리뷰 세 번째입니다.'],
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.titles).toHaveLength(3);
    expect(json.data.bubbleCopies).toHaveLength(3);
    expect(json.data.sellingPoints).toHaveLength(3);
  });

  it('빈 배열 입력: reviews: [] 전송 시 400 Bad Request를 반환한다', async () => {
    const request = makeRequest({ reviews: [] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('비어있지 않은 배열');
    // generateCopyFromReviews는 호출되지 않아야 함
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });

  it('리뷰 개수 초과: 51개 리뷰 전송 시 400 Bad Request를 반환한다 (최대 50개 제한)', async () => {
    const reviews = Array.from({ length: 51 }, (_, i) => `리뷰 ${i + 1}번입니다.`);
    const request = makeRequest({ reviews });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('50개');
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });

  it('정확히 50개 리뷰: 경계값 50개는 정상 처리된다', async () => {
    mockGenerateCopy.mockResolvedValueOnce(MOCK_COPY_OUTPUT);
    const reviews = Array.from({ length: 50 }, (_, i) => `리뷰 ${i + 1}번입니다.`);
    const request = makeRequest({ reviews });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('reviews 필드 누락: 요청 바디에 reviews 없을 시 400을 반환한다', async () => {
    const request = makeRequest({ productName: '테스트 상품' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });

  it('reviews 배열에 빈 문자열 포함: 400을 반환한다', async () => {
    const request = makeRequest({ reviews: ['정상 리뷰', '', '또 다른 리뷰'] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('비어있지 않은 문자열');
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });

  it('reviews가 배열이 아닌 문자열: 400을 반환한다', async () => {
    const request = makeRequest({ reviews: '단일 리뷰 문자열' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });

  it('AI API 500 에러: generateCopyFromReviews가 일반 Error를 throw하면 500 응답을 반환한다', async () => {
    mockGenerateCopy.mockRejectedValueOnce(new Error('내부 AI 처리 오류가 발생했습니다.'));

    const request = makeRequest({ reviews: ['정상 리뷰입니다.'] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('내부 AI 처리 오류');
  });

  it('AI API 타임아웃: AbortError를 throw하면 500 응답을 반환한다', async () => {
    // fetch AbortController 타임아웃 시뮬레이션
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    mockGenerateCopy.mockRejectedValueOnce(abortError);

    const request = makeRequest({ reviews: ['타임아웃 테스트 리뷰'] });
    const response = await POST(request);
    const json = await response.json();

    // AbortError는 일반 Error이므로 500으로 처리됨
    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('aborted');
  });

  it('비정상 JSON 응답: AI가 plain text를 반환해 AiResponseParseError가 발생하면 500을 반환한다', async () => {
    // Zod 파싱 실패 시나리오 — parseCopyResponse가 던지는 AiResponseParseError 시뮬레이션
    mockGenerateCopy.mockRejectedValueOnce(
      new Error('[Claude] JSON 파싱 실패: Unexpected token \'죄\', "죄송합니다, 처리할 수 없습니다." is not valid JSON'),
    );

    const request = makeRequest({ reviews: ['정상 리뷰입니다.'] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('JSON 파싱 실패');
  });

  it('ANTHROPIC_API_KEY 누락: 키 누락 오류를 throw하면 503을 반환한다', async () => {
    mockGenerateCopy.mockRejectedValueOnce(
      new Error('[Claude] 환경변수 ANTHROPIC_API_KEY가 설정되지 않았습니다.'),
    );

    const request = makeRequest({ reviews: ['API 키 없는 테스트'] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('AI API 키');
  });

  it('AI 과부하 오류: overloaded 메시지가 포함된 Error throw 시 503을 반환한다', async () => {
    mockGenerateCopy.mockRejectedValueOnce(
      new Error('Claude API is temporarily overloaded'),
    );

    const request = makeRequest({ reviews: ['과부하 테스트 리뷰'] });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain('과부하');
  });

  it('유효하지 않은 JSON 바디: JSON 파싱 자체가 실패하면 400을 반환한다', async () => {
    const request = new NextRequest('http://localhost:3000/api/ai/generate-copy', {
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

  it('productName 선택 필드: productName이 있으면 generateCopyFromReviews에 그대로 전달된다', async () => {
    mockGenerateCopy.mockResolvedValueOnce(MOCK_COPY_OUTPUT);

    const request = makeRequest({
      reviews: ['리뷰 하나입니다.'],
      productName: '카라비너 우산',
    });
    await POST(request);

    expect(mockGenerateCopy).toHaveBeenCalledWith({
      reviews: ['리뷰 하나입니다.'],
      productName: '카라비너 우산',
    });
  });

  it('productName이 문자열이 아닌 타입: 400을 반환한다', async () => {
    const request = makeRequest({
      reviews: ['정상 리뷰'],
      productName: 12345, // 숫자 → 검증 실패
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockGenerateCopy).not.toHaveBeenCalled();
  });
});
