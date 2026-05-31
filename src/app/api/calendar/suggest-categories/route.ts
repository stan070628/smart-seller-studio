import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';

const SYSTEM_PROMPT = `당신은 쿠팡 소싱 전문가입니다.
쿠팡에서 단품으로 공략 가능한 대분류와 각 대분류의 소분류를 추천합니다.
규칙:
- 대분류: 6~8개, 너무 넓지 않은 적절한 범위 (예: "반려동물용품" 적합 / "생활" 너무 넓음)
- 각 대분류당 소분류: 5~7개, 쿠팡 단품 판매 가능한 구체적 카테고리
- 브랜드명 제외
반드시 JSON 배열 형식만 반환하세요.`;

interface RawCategory {
  name?: unknown;
  subcategories?: unknown;
}

function parseCategories(rawText: string): { name: string; subcategories: string[] }[] {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = JSON.parse(stripped) as unknown;
  if (!Array.isArray(parsed)) throw new Error('응답이 배열이 아닙니다.');
  return (parsed as RawCategory[]).map((item) => {
    if (typeof item.name !== 'string') throw new Error('name 필드 누락');
    if (!Array.isArray(item.subcategories)) throw new Error('subcategories 필드 누락');
    return {
      name: item.name,
      subcategories: (item.subcategories as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      ),
    };
  });
}

export async function POST(req: NextRequest) {
  let body: { currentCategories?: unknown };
  try {
    body = await req.json() as { currentCategories?: unknown };
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  if (!Array.isArray(body.currentCategories) || body.currentCategories.length === 0) {
    return NextResponse.json(
      { error: 'currentCategories는 필수 배열입니다.' },
      { status: 400 },
    );
  }

  const currentCategories = (body.currentCategories as unknown[]).filter(
    (v): v is string => typeof v === 'string',
  );

  const userContent = `현재 대분류: ${currentCategories.join(', ')}

현재와 다른 새로운 관점의 대분류와 소분류를 추천해 주세요.
중복 없이, 소싱 유망한 카테고리 위주로 구성해 주세요.
JSON만 반환: [{"name": "반려동물용품", "subcategories": ["강아지 간식", ...]}, ...]`;

  try {
    const rawText = await callClaude(SYSTEM_PROMPT, userContent, 'haiku');
    const parsed = parseCategories(rawText);

    const now = Date.now();
    const categories = parsed.map((cat, catIdx) => ({
      id: `ai-cat-${cat.name}-${now + catIdx}`,
      name: cat.name,
      subcategories: cat.subcategories.map((subName, subIdx) => ({
        id: `ai-sub-${subName}-${now + catIdx * 100 + subIdx}`,
        name: subName,
      })),
    }));

    return NextResponse.json({ categories, suggestedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[suggest-categories] 오류:', message);
    return NextResponse.json({ error: '카테고리 추천에 실패했습니다.' }, { status: 500 });
  }
}
