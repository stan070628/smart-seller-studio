/**
 * Claude 13-Frame 카피 생성 응답 Zod 검증 스키마
 */

import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
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

/**
 * JSON 문자열 내부의 raw 줄바꿈·탭을 이스케이프 시퀀스로 치환
 *
 * Claude가 JSON value 안에 literal newline/tab을 출력하는 경우 대응.
 * "..." 쌍 사이에 있는 제어문자만 치환하므로 JSON 구조 자체는 유지.
 */
function sanitizeJsonStrings(text: string): string {
  // JSON string 내부만 대상으로 개행·탭 이스케이프
  // (외부 공백은 그대로 유지)
  return text.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) => {
    const escaped = inner
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });
}

/**
 * Claude 응답에서 JSON 객체만 추출 + 자동 복구
 *
 * 시도 순서:
 * 1. 코드펜스 제거 + '{' ~ '}' 범위 잘라냄
 * 2. JSON.parse 직접 시도
 * 3. jsonrepair → 결과를 JSON.parse로 재검증
 * 4. raw 줄바꿈 이스케이프 후 JSON.parse
 * 5. 이스케이프 후 jsonrepair → 재검증
 * 6. 모두 실패 시 원본 반환 (상위 catch에서 AiResponseParseError throw)
 */
function extractJson(rawText: string): string {
  // 코드펜스 제거
  let text = rawText
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // 첫 '{' ~ 마지막 '}' 추출
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  // 1차: 그대로 파싱
  try {
    JSON.parse(text);
    return text;
  } catch { /* continue */ }

  // 2차: jsonrepair + 결과 검증
  try {
    const repaired = jsonrepair(text);
    JSON.parse(repaired); // 복구 결과가 실제로 유효한지 확인
    return repaired;
  } catch { /* continue */ }

  // 3차: raw 줄바꿈·탭 이스케이프 후 재시도
  try {
    const sanitized = sanitizeJsonStrings(text);
    JSON.parse(sanitized);
    return sanitized;
  } catch { /* continue */ }

  // 4차: 이스케이프 + jsonrepair + 결과 검증
  try {
    const sanitized = sanitizeJsonStrings(text);
    const repaired = jsonrepair(sanitized);
    JSON.parse(repaired);
    return repaired;
  } catch { /* continue */ }

  // 모두 실패: 원본 반환 (상위에서 AiResponseParseError throw)
  return text;
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
    // 디버그: 파싱 실패 시 응답 앞 300자와 오류 위치 로깅
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[Claude 13-Frame] JSON 파싱 실패:', errMsg);
    console.error('[Claude 13-Frame] 응답 앞 300자:', raw.slice(0, 300));
    console.error('[Claude 13-Frame] 응답 뒤 300자:', raw.slice(-300));
    throw new AiResponseParseError(
      `[Claude 13-Frame] JSON 파싱 실패: ${errMsg}`,
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
