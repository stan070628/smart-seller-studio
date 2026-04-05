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
  imagePrompt: z.string().max(500).nullable().optional(),
  needsProductImage: z.boolean().optional().default(false),
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

// ─────────────────────────────────────────────────────────────────────────────
// 아이콘 배열 검증 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** icons 배열이 존재할 경우 문자열 배열인지 검증하고, 예상 길이와 일치하는지 확인합니다. */
export function validateIcons(
  metadata: Record<string, unknown>,
  expectedLength: number,
  frameType: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (!('icons' in metadata)) {
    warnings.push(`[${frameType}] metadata.icons 누락`);
    return { valid: false, warnings };
  }

  const icons = metadata.icons;

  if (!Array.isArray(icons)) {
    warnings.push(`[${frameType}] metadata.icons가 배열이 아닙니다`);
    return { valid: false, warnings };
  }

  const nonString = (icons as unknown[]).filter((v) => typeof v !== 'string');
  if (nonString.length > 0) {
    warnings.push(`[${frameType}] metadata.icons에 문자열이 아닌 항목이 포함되어 있습니다`);
    return { valid: false, warnings };
  }

  if (icons.length !== expectedLength) {
    warnings.push(
      `[${frameType}] metadata.icons 길이 불일치: 예상 ${expectedLength}개, 실제 ${icons.length}개`
    );
    return { valid: false, warnings };
  }

  return { valid: true, warnings };
}

/** 카드형 프레임 4종의 icons 배열을 일괄 검증합니다. 경고 목록을 반환합니다. */
export function validateCardFrameIcons(frames: GeneratedFrame[]): string[] {
  const CARD_FRAME_CONFIG: Record<string, { arrayKey: string; expectedLength: number }> = {
    pain_point: { arrayKey: 'painPoints', expectedLength: 3 },
    solution:   { arrayKey: 'solutions',  expectedLength: 3 },
    detail_1:   { arrayKey: 'bulletPoints', expectedLength: 3 },
    target:     { arrayKey: 'personas',   expectedLength: 3 },
  };

  const allWarnings: string[] = [];

  for (const frame of frames) {
    const config = CARD_FRAME_CONFIG[frame.frameType];
    if (!config) continue;
    if (frame.skip) continue;

    const metadata = (frame.metadata ?? {}) as Record<string, unknown>;

    // 실제 배열 길이가 있으면 그것을 기준으로 사용 (solution은 2~3개 허용)
    const cardArray = metadata[config.arrayKey];
    const actualLength = Array.isArray(cardArray) ? cardArray.length : config.expectedLength;

    const { warnings } = validateIcons(metadata, actualLength, frame.frameType);
    allWarnings.push(...warnings);
  }

  return allWarnings;
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
