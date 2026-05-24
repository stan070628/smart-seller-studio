/**
 * 이미지 텍스트 합성 파이프라인
 *
 * Gemini 2.5 Flash Image는 한국어 글자 렌더링이 부정확하므로,
 * AI 이미지 편집 대신 (1) Claude Vision OCR로 텍스트 영역 추출,
 * (2) Claude로 사용자 의도 파싱, (3) Sharp + Pretendard로 한글 정확히 합성.
 *
 * 디자인 문서·plan: ~/.claude/plans/quiet-baking-fox.md
 */

import type { OverlayOptions } from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { callClaude } from '@/lib/ai/claude-cli';
import { withRetry } from '@/lib/ai/resilience';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

export interface TextRegion {
  text: string;
  bbox: { x: number; y: number; w: number; h: number }; // 픽셀
  estimatedColor?: string;       // hex, 예: "#222222"
  estimatedFontSizePx?: number;
  bold?: boolean;
}

export interface EditOperation {
  region: TextRegion;
  newText: string;
}

// ─────────────────────────────────────────
// OCR — Claude Vision으로 텍스트 영역 추출
// ─────────────────────────────────────────

const TextRegionResponseSchema = z.object({
  regions: z.array(
    z.object({
      text: z.string(),
      bbox: z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      }),
      estimatedColor: z.string().optional(),
      estimatedFontSizePx: z.number().int().positive().optional(),
      bold: z.boolean().optional(),
    }),
  ),
});

const EXTRACT_SYSTEM_PROMPT = `당신은 이미지 텍스트 영역을 정확히 추출하는 OCR 분석가입니다.
주어진 이미지에 표시된 모든 한국어/영문/숫자 텍스트 블록을 추출하세요.

각 텍스트 블록에 대해:
- text: 보이는 그대로의 문자열 (한 줄)
- bbox: 텍스트가 차지하는 사각형 영역의 픽셀 좌표 { x, y, w, h }. (0,0)이 좌상단.
- estimatedColor: 글자 색의 16진수 hex (예: "#222222")
- estimatedFontSizePx: 글자 높이를 픽셀로 추정 (정수)
- bold: 굵은 글씨이면 true

규칙:
- 한 줄 = 한 region. 여러 줄은 분리.
- 매우 작은 장식 텍스트(워터마크 등)는 생략 가능.
- bbox는 가능한 정확하게. 텍스트 글리프 윤곽 기준.
- 응답은 JSON만 반환. 코드 블록·설명 텍스트 금지.

출력 스키마:
{ "regions": [ { "text": "...", "bbox": {"x":0,"y":0,"w":0,"h":0}, "estimatedColor":"#000", "estimatedFontSizePx":24, "bold":false } ] }`;

export async function extractTextRegions(
  imageBase64: string,
  mimeType: AllowedMimeType,
): Promise<TextRegion[]> {
  const client = getAnthropicClient();
  const response = await withRetry(
    () =>
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: imageBase64 },
              },
              {
                type: 'text',
                text: '이 이미지의 모든 텍스트 영역을 JSON으로 추출하세요.',
              },
            ],
          },
        ],
      }),
    { label: 'Claude extractTextRegions' },
  );

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OCR 응답에서 JSON을 찾을 수 없습니다.');
  const parsed = TextRegionResponseSchema.parse(JSON.parse(match[0]));
  return parsed.regions;
}

// ─────────────────────────────────────────
// 의도 파싱 — Claude Haiku로 어떤 region을 어떤 새 텍스트로 바꿀지 결정
// ─────────────────────────────────────────

const EditOperationResponseSchema = z.object({
  operations: z.array(
    z.object({
      regionIndex: z.number().int().nonnegative(),
      newText: z.string().min(1).max(500),
    }),
  ),
});

const INTENT_SYSTEM_PROMPT = `당신은 한국 이커머스 상세페이지 텍스트 편집 어시스턴트입니다.
사용자가 어떤 텍스트 영역을 어떻게 바꾸길 원하는지 파싱하세요.

입력:
- regions: 이미지의 텍스트 영역 배열. index, text(원본 텍스트) 포함.
- userInstruction: 사용자의 편집 지시문.
- productName: 상품명 (있을 수도 있음, 컨텍스트 보조용).

규칙:
- 사용자가 명시적으로 가리킨 영역만 수정. 모호하면 가장 그럴듯한 1~2개만.
- "자동 다듬기" 같이 전체 텍스트 자연화 요청이면 모든 영역의 한국어를 자연스럽게 다듬어 newText로 반환.
- "강조/가독성" 같이 시각적 효과 요청은 newText에 원본을 그대로 유지하되 굵게/대비 강조는 합성 단계에서 처리한다고 가정 (newText만 결정).
- 새 텍스트는 영역에 들어갈 수 있을 만큼의 길이 (원본의 1.3배 이내 권장).
- 응답은 JSON만 반환. 코드 블록·설명 금지.

출력 스키마:
{ "operations": [ { "regionIndex": 0, "newText": "..." } ] }`;

export async function parseEditIntent(
  regions: TextRegion[],
  userInstruction: string,
  productName?: string,
): Promise<EditOperation[]> {
  const regionsForPrompt = regions.map((r, i) => ({
    index: i,
    text: r.text,
  }));

  const userPrompt = [
    `상품명: ${productName ?? '(없음)'}`,
    '',
    `[텍스트 영역들]`,
    JSON.stringify(regionsForPrompt, null, 2),
    '',
    `[사용자 지시]`,
    userInstruction,
    '',
    '위 지시에 따라 수정할 영역을 JSON으로 결정하세요.',
  ].join('\n');

  const raw = await withRetry(
    () => callClaude(INTENT_SYSTEM_PROMPT, userPrompt, 'haiku', 800),
    { label: 'Claude parseEditIntent' },
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('의도 파싱 응답에서 JSON을 찾을 수 없습니다.');
  const parsed = EditOperationResponseSchema.parse(JSON.parse(match[0]));

  return parsed.operations
    .filter((op) => op.regionIndex < regions.length)
    .map((op) => ({
      region: regions[op.regionIndex],
      newText: op.newText,
    }));
}

// ─────────────────────────────────────────
// 합성 — Sharp + @resvg/resvg-js + Pretendard
// ─────────────────────────────────────────

const FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'PretendardVariable.ttf');

/**
 * SVG 텍스트 escape: XML 특수문자 처리
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Operation의 newText가 region.bbox에 들어가도록 폰트 사이즈를 자동 조정한다.
 * 원본 추정 사이즈 → 너무 길면 줄여서 맞춤. 너무 작으면 (8px 미만) 8px로.
 */
function calcFontSize(region: TextRegion, newText: string): number {
  const baseSize = region.estimatedFontSizePx ?? Math.floor(region.bbox.h * 0.7);
  // 가로 한 줄로 들어간다고 가정. 한 글자가 baseSize * 0.55 정도 가로폭.
  const estimatedWidth = newText.length * baseSize * 0.55;
  if (estimatedWidth <= region.bbox.w) return baseSize;
  const scaled = Math.floor((region.bbox.w / (newText.length * 0.55)) * 0.95);
  return Math.max(8, scaled);
}

/**
 * 원본 이미지 위에 operations의 새 텍스트를 합성한다.
 * 각 region을 흰색으로 마스킹한 뒤 Pretendard로 새 텍스트를 그린다.
 *
 * 반환: 합성된 JPEG buffer
 */
export async function composeTextOnImage(
  imageBuffer: Buffer,
  operations: EditOperation[],
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const { Resvg } = await import('@resvg/resvg-js');

  if (operations.length === 0) {
    // 변경 없으면 원본 그대로 (JPEG 재인코딩)
    return sharp(imageBuffer).jpeg({ quality: 92 }).toBuffer();
  }

  // 1) 원본 이미지를 PNG로 일단 보존
  let working = sharp(imageBuffer);
  const meta = await working.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (!imgW || !imgH) throw new Error('합성 실패: 원본 이미지 크기를 알 수 없습니다.');

  // 2) 각 operation에 대해 마스킹 사각형 + 새 텍스트 SVG composite 준비
  const composites: OverlayOptions[] = [];

  for (const op of operations) {
    const { region, newText } = op;
    // 영역이 이미지 밖이면 스킵
    if (
      region.bbox.x >= imgW ||
      region.bbox.y >= imgH ||
      region.bbox.w <= 0 ||
      region.bbox.h <= 0
    ) {
      continue;
    }
    const w = Math.min(region.bbox.w, imgW - region.bbox.x);
    const h = Math.min(region.bbox.h, imgH - region.bbox.y);

    // 2a) 마스킹 (흰색 사각형) — 사용자 추정 배경색 활용 가능하지만 1차는 흰색.
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/></svg>`;
    composites.push({
      input: Buffer.from(maskSvg),
      left: region.bbox.x,
      top: region.bbox.y,
    });

    // 2b) 새 텍스트 렌더 (Pretendard) — resvg-js로 PNG 변환
    const fontSize = calcFontSize(region, newText);
    const color = region.estimatedColor ?? '#222222';
    const weight = region.bold ? 700 : 500;
    // baseline 정렬: dominant-baseline=middle + y=h/2
    const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="0" y="${Math.floor(h / 2)}" font-family="Pretendard" font-size="${fontSize}" font-weight="${weight}" fill="${color}" dominant-baseline="middle">${escapeXml(newText)}</text></svg>`;

    const resvg = new Resvg(textSvg, {
      font: {
        fontFiles: [FONT_PATH],
        loadSystemFonts: false,
        defaultFontFamily: 'Pretendard',
      },
    });
    const textPng = resvg.render().asPng();

    composites.push({
      input: textPng,
      left: region.bbox.x,
      top: region.bbox.y,
    });
  }

  return working.composite(composites).jpeg({ quality: 92 }).toBuffer();
}

/**
 * 폰트 파일이 존재하는지 검증 (라우트 startup용).
 * Vercel 빌드 시 public/ 디렉토리가 함수 번들에 포함된다.
 */
export async function ensureFontAvailable(): Promise<void> {
  await fs.access(FONT_PATH);
}
