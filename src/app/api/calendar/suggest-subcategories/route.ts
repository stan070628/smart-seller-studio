import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';

const SYSTEM_PROMPT = `당신은 쿠팡 소싱 전문가입니다.
주어진 대분류에서 현재 트렌드에 맞는 소분류를 추천합니다.
선별 기준:
- 쿠팡에서 단품으로 판매 가능한 상품 카테고리
- 너무 넓거나 좁지 않은 적절한 범위 (예: "텀블러" 적합 / "주방용품" 너무 넓음 / "분홍 텀블러" 너무 좁음)
- 브랜드명 제외
반드시 JSON 배열 형식만 반환하세요.`;

const FALLBACK_SUFFIXES = ['용품', '소품', '세트', '미니', '대형', '휴대용'];

function makeFallback(parentCategory: string): { id: string; name: string }[] {
  const now = Date.now();
  return FALLBACK_SUFFIXES.map((suffix, i) => ({
    id: `ai-${parentCategory}${suffix}-${now + i}`,
    name: `${parentCategory} ${suffix}`,
  }));
}

function parseNames(rawText: string): string[] {
  try {
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: { parentCategory?: unknown; currentSubcategories?: unknown };
  try {
    body = await req.json() as { parentCategory?: unknown; currentSubcategories?: unknown };
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  if (typeof body.parentCategory !== 'string' || !body.parentCategory.trim()) {
    return NextResponse.json(
      { error: 'parentCategory는 필수 문자열입니다.' },
      { status: 400 },
    );
  }

  const parentCategory = body.parentCategory.trim();
  const currentSubcategories = Array.isArray(body.currentSubcategories)
    ? (body.currentSubcategories as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const userContent = `대분류: ${parentCategory}
현재 소분류: ${currentSubcategories.join(', ') || '없음'}

위 대분류에서 소싱 관점으로 유망한 소분류 6~8개를 추천해 주세요.
현재 소분류와 중복되지 않게, 새로운 관점으로 추천해 주세요.
JSON 배열만 반환: ["보온병", "캠핑컵", ...]`;

  try {
    const rawText = await callClaude(SYSTEM_PROMPT, userContent, 'haiku');
    const names = parseNames(rawText);
    const now = Date.now();
    const subcategories = names.length > 0
      ? names.map((name, i) => ({ id: `ai-${name}-${now + i}`, name }))
      : makeFallback(parentCategory);

    return NextResponse.json({ subcategories, suggestedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({
      subcategories: makeFallback(parentCategory),
      suggestedAt: new Date().toISOString(),
    });
  }
}
