// src/__tests__/api/analyze-image.test.ts
// OCR 통합 동작(병렬 호출, 응답 포함, graceful degradation) 테스트

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/ai/analyze-image/route";
import { NextRequest } from "next/server";

const mockMessagesCreate = vi.fn();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue("key"),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock("@/lib/ai/claude", () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

vi.mock("@/lib/ai/clova-ocr", () => ({
  extractTextFromImage: vi.fn(),
}));

import { extractTextFromImage } from "@/lib/ai/clova-ocr";
const mockExtractText = vi.mocked(extractTextFromImage);

// ImageAnalysisSchema 통과에 필요한 최소 유효 응답
const MOCK_VISION_JSON = JSON.stringify({
  material: "플라스틱 소재로 가볍고 내구성이 뛰어납니다",
  shape: "원통형 텀블러 형태로 하단이 넓어 안정적입니다",
  colors: ["흰색"],
  keyComponents: ["이중벽 구조", "실리콘 뚜껑"],
  visualPrompt:
    "A cinematic product shot of a white plastic tumbler on a clean studio background --ar 9:16",
});

const MOCK_CLAUDE_RESPONSE = {
  content: [{ type: "text", text: MOCK_VISION_JSON }],
};

// 1x1 투명 PNG base64 (CLOVA OCR 실제 호출 없이 형식 검증용)
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/ai/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/analyze-image (OCR 통합)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OCR 성공 시 data.ocrText가 응답에 포함된다", async () => {
    mockMessagesCreate.mockResolvedValueOnce(MOCK_CLAUDE_RESPONSE);
    mockExtractText.mockResolvedValueOnce(["500ml", "BPA-FREE"]);

    const req = makeRequest({
      images: [{ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ocrText).toEqual(["500ml", "BPA-FREE"]);
  });

  it("OCR 실패 시 graceful degradation — data.ocrText: []", async () => {
    mockMessagesCreate.mockResolvedValueOnce(MOCK_CLAUDE_RESPONSE);
    mockExtractText.mockRejectedValueOnce(new Error("CLOVA OCR 네트워크 오류"));

    const req = makeRequest({
      images: [{ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ocrText).toEqual([]);
  });

  it("OCR가 빈 배열 반환 시 data.ocrText: []", async () => {
    mockMessagesCreate.mockResolvedValueOnce(MOCK_CLAUDE_RESPONSE);
    mockExtractText.mockResolvedValueOnce([]);

    const req = makeRequest({
      images: [{ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }],
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.data.ocrText).toEqual([]);
  });

  it("Claude Vision 실패 시 500 반환", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("Claude API 오류"));
    mockExtractText.mockResolvedValueOnce([]);

    const req = makeRequest({
      images: [{ imageBase64: TINY_PNG_BASE64, mimeType: "image/png" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
