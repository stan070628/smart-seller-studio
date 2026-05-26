// src/__tests__/api/speech-to-text.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/ai/speech-to-text/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue("key"),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock("@/lib/ai/clova-speech", () => ({
  transcribeAudio: vi.fn(),
}));

import { transcribeAudio } from "@/lib/ai/clova-speech";
const mockTranscribeAudio = vi.mocked(transcribeAudio);

function makeAudioRequest(byteLength = 1024): NextRequest {
  return new NextRequest("http://localhost/api/ai/speech-to-text", {
    method: "POST",
    body: new ArrayBuffer(byteLength),
    headers: { "Content-Type": "application/octet-stream" },
  });
}

describe("POST /api/ai/speech-to-text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("빈 바디 → 400", async () => {
    const req = makeAudioRequest(0);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });

  it("성공 → 200 + {success: true, text}", async () => {
    mockTranscribeAudio.mockResolvedValueOnce("안녕하세요 테스트입니다");
    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.text).toBe("안녕하세요 테스트입니다");
  });

  it("환경변수 미설정 에러 → 503", async () => {
    mockTranscribeAudio.mockRejectedValueOnce(
      new Error("NAVER_CLOVA_SPEECH_API_KEY_ID 환경변수가 설정되지 않았습니다")
    );
    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("STT API 실패 → 500", async () => {
    mockTranscribeAudio.mockRejectedValueOnce(new Error("CLOVA Speech API 오류: 500"));
    const res = await POST(makeAudioRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
