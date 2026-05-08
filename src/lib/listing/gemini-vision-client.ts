import sharp from 'sharp';
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export interface TextBlock {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
}

const MODEL = 'gemini-2.0-flash';

const PROMPT = `이 이미지에서 보이는 모든 중국어 텍스트를 추출해주세요.

각 텍스트마다 위치(bounding box)를 normalized 0~1000 좌표로 [ymin, xmin, ymax, xmax] 형식으로 반환하세요.
글자가 큰 단위(제목, 라벨)는 한 블록으로, 줄이 다르면 별개 블록으로 처리하세요.
영어/숫자만 있는 텍스트는 무시하고, 중국어가 포함된 것만 반환하세요.
중국어가 전혀 없으면 빈 배열을 반환하세요.

출력은 JSON 한 객체. 다른 설명 절대 추가 금지.

출력 형식:
{ "blocks": [ { "text": "产品", "box_2d": [100, 50, 200, 250] }, ... ] }`;

const responseSchema = z.object({
  blocks: z.array(
    z.object({
      text: z.string(),
      box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    })
  ),
});

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/**
 * 이미지 버퍼에서 중국어 텍스트 블록을 추출합니다.
 * Gemini Flash가 OCR + bbox(normalized 0~1000)을 한 번에 반환하면,
 * sharp metadata로 실제 이미지 크기를 받아 픽셀 좌표로 환산합니다.
 */
export async function extractTextBlocks(imageBuffer: Buffer): Promise<TextBlock[]> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('[gemini-vision] 이미지 크기를 알 수 없습니다.');
  }

  const ai = getGeminiGenAI();
  const response = await ai.models.generateContent({
    model: MODEL,
    config: { responseMimeType: 'application/json' },
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: meta.format === 'png' ? 'image/png' : 'image/jpeg',
              data: imageBuffer.toString('base64'),
            },
          },
          { text: PROMPT },
        ],
      },
    ],
  });

  const rawText =
    response.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('') ?? '';
  const cleaned = stripCodeFences(rawText);
  if (!cleaned) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(jsonrepair(cleaned));
  }
  const validated = responseSchema.safeParse(parsed);
  if (!validated.success) return [];

  return validated.data.blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const x = Math.round((xmin / 1000) * width);
      const y = Math.round((ymin / 1000) * height);
      const w = Math.round(((xmax - xmin) / 1000) * width);
      const h = Math.round(((ymax - ymin) / 1000) * height);
      return { text: b.text, bbox: { x, y, w, h } };
    })
    .filter((b) => b.bbox.w > 0 && b.bbox.h > 0);
}
