import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';

export const TRANSLATE_OVERLAY_SYSTEM_PROMPT = `당신은 중국 1688 상품 이미지의 텍스트를 한국 쿠팡 셀러용으로 번역하는 전문가입니다.

규칙:
1. 자연스러운 한국어 구어체로. 번역투(예: "본 제품은", "해당 제품의", "~이 됩니다") 금지.
2. 길이는 가능한 한 원문과 비슷하게 — 이미지 위 박스에 들어가야 함.
3. 단위·숫자·치수는 그대로(예: cm, kg, M, L, XL).
4. 의미가 불분명하거나 단순 장식 글자면 가장 그럴듯한 한국어 한 단어로.
5. 출력은 JSON 한 객체. 다른 설명 절대 추가 금지.

출력 형식:
{ "translations": [ { "index": 0, "ko": "..." }, { "index": 1, "ko": "..." }, ... ] }`;

export function buildTranslateOverlayUserPrompt(texts: string[]): string {
  const list = texts.map((t, i) => `${i}: ${t}`).join('\n');
  return `다음 중국어 텍스트를 한국어로 번역하세요. 각 항목은 1688 상품 이미지에서 추출된 별개의 단어/구절입니다.

${list}

규칙대로 JSON으로만 출력하세요.`;
}

const responseSchema = z.object({
  translations: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      ko: z.string(),
    })
  ),
});

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export function parseTranslateOverlayResponse(rawText: string, expectedLength: number): string[] {
  const cleaned = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(jsonrepair(cleaned));
  }
  const validated = responseSchema.parse(parsed);
  if (validated.translations.length !== expectedLength) {
    throw new Error(
      `[translate-overlay] 응답 길이 불일치: 기대 ${expectedLength}, 실제 ${validated.translations.length}`
    );
  }
  const ordered = new Array<string>(expectedLength).fill('');
  for (const item of validated.translations) {
    if (item.index >= 0 && item.index < expectedLength) {
      ordered[item.index] = item.ko;
    }
  }
  return ordered;
}
