/**
 * 코스트코 가격표 사진 판독
 *
 * 매대에서 찍은 가격표 1장에서 상품코드·상품명·가격·단가를 뽑는다.
 * 상품코드 타이핑을 대체하는 입력 경로다.
 *
 * 🔴 엔진 선택 근거 (2026-09-05)
 *   - Clova OCR: 키 미보유(.env.local에 CLOVA_* 0건) → 신규 발급 필요
 *   - Claude Vision: ANTHROPIC_API_KEY 크레딧 소진
 *   - Gemini: GOOGLE_AI_API_KEY가 이미지 생성에 상시 사용 중이라 살아 있음 → 채택
 *
 * 실측(2026-09-05): 회전·곡면 왜곡된 실물 가격표 2장에서 코드·브랜드·상품명·가격 전부 정확.
 * 트루릴리젼 692469 / 24,990원이 위키 기록과 일치했다.
 *
 * 🔵 2026-09-06 속도 개선 — gemini-2.5-flash(7~11초) → gemini-3.5-flash-lite(1.3~1.8초).
 *    이미지를 3.8MB→100KB로 줄여도 7~9초로 안 줄어 병목이 업로드가 아니라 추론임이 드러났고,
 *    모델을 바꾸자 5배 빨라졌다. 정확도는 동일(같은 코드·가격·브랜드), 비용은 절반(0.25원).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getGeminiGenAI } from '@/lib/ai/gemini';
import { requireAuth } from '@/lib/supabase/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 업로드 상한 — 폰 사진 원본(3~5MB)을 그대로 받되 과도한 것은 막는다 */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;

const PROMPT = `이 사진은 코스트코 매장의 상품 가격표다. 사진이 회전돼 있거나 곡면이라 글자가 휘어 있을 수 있다.

다음을 JSON으로만 답하라(설명 없이):
{
  "product_code": "가격표 좌측의 6~7자리 상품번호(숫자만)",
  "brand": "브랜드명. 없으면 null",
  "name_ko": "한글 상품명",
  "name_en": "영문 상품명. 없으면 null",
  "spec": "용량/중량/수량 표기 그대로 (예: 283.5G, 750ml x 2)",
  "price": 가격 숫자만(콤마 없이),
  "unit_price_text": "단가 표기 그대로 (예: 단가/10G 599원). 없으면 null",
  "has_discount_mark": 가격표에 할인/특가 표시(★, 노란 배경, 할인 문구)가 있으면 true 아니면 false,
  "confidence": "high" | "medium" | "low"
}

읽을 수 없는 항목은 null로 둔다. 추측하지 마라 — 특히 상품코드와 가격은 확실할 때만 채운다.`;

export interface TagOcrResult {
  product_code: string | null;
  brand: string | null;
  name_ko: string | null;
  name_en: string | null;
  spec: string | null;
  price: number | null;
  unit_price_text: string | null;
  has_discount_mark: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('image');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: '이미지를 읽지 못했습니다.' }, { status: 400 });
  }
  if (!file) {
    console.warn('[tag-ocr] 400 · 이미지 필드 없음');
    return NextResponse.json({ error: '이미지가 없습니다.' }, { status: 400 });
  }
  console.log(`[tag-ocr] 수신 ${(file.size / 1024).toFixed(0)}KB · type="${file.type || '(빈값)'}"`);

  // 🔴 2026-09-06: 아이폰 카메라 원본이 HEIC 또는 빈 MIME으로 올라와 400으로 잘렸다.
  //    클라이언트가 canvas로 JPEG 변환해 보내지만, 변환 실패 시 원본이 그대로 오므로
  //    서버도 heic/heif를 받아준다. Gemini가 처리 못 하면 그때 422로 떨어지는 편이
  //    「형식이 아니라서 거부」보다 진단에 낫다.
  const rawMime = (file.type || '').toLowerCase();
  const mime = ALLOWED.includes(rawMime as (typeof ALLOWED)[number]) ? rawMime : 'image/jpeg';
  if (rawMime && !ALLOWED.includes(rawMime as (typeof ALLOWED)[number]) && !/hei[cf]/.test(rawMime)) {
    return NextResponse.json({ error: `지원하지 않는 형식입니다: ${rawMime}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    console.warn(`[tag-ocr] 400 · 크기 초과 ${(file.size / 1024 / 1024).toFixed(1)}MB`);
    return NextResponse.json({ error: '이미지가 너무 큽니다(8MB 초과).' }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  try {
    const ai = getGeminiGenAI();
    const r = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data: base64 } },
          { text: PROMPT },
        ],
      }],
    });

    const text = r.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error('[tag-ocr] JSON 파싱 실패:', text.slice(0, 200));
      return NextResponse.json({ error: '가격표를 읽지 못했습니다. 다시 찍어주세요.' }, { status: 422 });
    }

    const parsed = JSON.parse(m[0]) as TagOcrResult;
    // 상품코드는 숫자만 남긴다 — 판독에 공백·하이픈이 섞여 들어올 수 있다
    if (parsed.product_code) parsed.product_code = String(parsed.product_code).replace(/\D/g, '') || null;

    console.log(
      `[tag-ocr] ${parsed.product_code ?? '코드없음'} · ${parsed.name_ko ?? '-'} · ${parsed.price ?? '-'}원 · ${parsed.confidence}`,
    );
    return NextResponse.json(parsed);
  } catch (e) {
    console.error('[tag-ocr] 실패:', e);
    return NextResponse.json({ error: '판독 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
