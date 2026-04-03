/**
 * Claude 13-Frame 카피 생성 응답 Zod 검증 스키마
 */

import { z } from 'zod';
import type { GeneratedFrame } from '@/types/frames';
import { AiResponseParseError } from '../schemas';

// ─────────────────────────────────────────────────────────────────────────────
// 스키마 정의
// ─────────────────────────────────────────────────────────────────────────────

const FRAME_TYPES = [
  'hero', 'pain_point', 'solution', 'usp',
  'detail_1', 'detail_2', 'how_to_use', 'before_after',
  'target', 'spec', 'faq', 'social_proof', 'cta',
] as const;

const GeneratedFrameSchema = z.object({
  frameType: z.enum(FRAME_TYPES),
  headline: z.string().max(50).nullable().optional(),
  subheadline: z.string().max(100).nullable().optional(),
  bodyText: z.string().nullable().optional(),
  ctaText: z.string().max(30).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().transform((v) => v ?? {}),
  skip: z.boolean().optional().default(false),
  imageDirection: z.string().nullable().optional(),
});

export const FrameGenerationResponseSchema = z.object({
  frames: z.array(GeneratedFrameSchema).length(13, '프레임은 반드시 13개여야 합니다'),
});

export type FrameGenerationResponse = z.infer<typeof FrameGenerationResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 파싱 함수
// ─────────────────────────────────────────────────────────────────────────────

function extractJson(rawText: string): string {
  return rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

export function parseFrameGenerationResponse(raw: string): GeneratedFrame[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (e) {
    throw new AiResponseParseError(
      `[Claude 13-Frame] JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
      raw
    );
  }

  const result = FrameGenerationResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiResponseParseError(
      `[Claude 13-Frame] 응답 스키마 검증 실패: ${result.error.issues.map((i) => i.message).join(' | ')}`,
      raw,
      result.error.issues
    );
  }

  return result.data.frames as GeneratedFrame[];
}
