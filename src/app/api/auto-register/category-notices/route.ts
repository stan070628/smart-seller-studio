/**
 * GET /api/auto-register/category-notices
 *
 * 쿠팡 카테고리 메타에서 고시정보(법정 표기사항) 항목을 조회한 뒤,
 * Claude AI로 상품 정보 기반 초안을 자동 생성하여 반환합니다.
 *
 * Query params:
 *   - categoryCode   (number, 필수) : 쿠팡 displayCategoryCode
 *   - productName    (string, 필수) : 상품명
 *   - productDesc    (string, 선택) : 상품 설명
 *   - certification  (string, 선택) : KC 인증번호 (있으면 고시정보에 반영)
 *
 * Response 200:
 *   { notices: [{ categoryName: string; detailName: string; content: string }] }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';
import { requireAuth } from '@/lib/supabase/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 최종 반환 고시정보 항목 */
interface NoticeItem {
  categoryName: string;
  detailName: string;
  content: string;
}

/**
 * getCategoryMeta noticeCategories 원소의 구조
 * 실제 API: { noticeCategoryName, noticeCategoryDetailNames: [{ noticeCategoryDetailName, required }] }
 */
interface RawNoticeCategory {
  noticeCategoryName?: string;
  noticeCategoryDetailNames?: Array<{
    noticeCategoryDetailName?: string;
    required?: string;
  }>;
  [key: string]: unknown;
}

/** AI에 전달하는 카테고리별 그룹 */
interface NoticeGroup {
  categoryName: string;
  detailNames: string[];
}

// ─────────────────────────────────────────────────────────────
// 카테고리 메타 캐시 (getCategoryMeta 응답만 캐시, AI 결과는 캐시 안 함)
// ─────────────────────────────────────────────────────────────

interface MetaCacheEntry {
  data: Record<string, unknown>;
  ts: number;
}

const META_CACHE = new Map<number, MetaCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

function getCachedMeta(categoryCode: number): Record<string, unknown> | null {
  const entry = META_CACHE.get(categoryCode);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    META_CACHE.delete(categoryCode);
    return null;
  }
  return entry.data;
}

function setCachedMeta(categoryCode: number, data: Record<string, unknown>): void {
  META_CACHE.set(categoryCode, { data, ts: Date.now() });
}

// ─────────────────────────────────────────────────────────────
// 헬퍼: getCategoryMeta 응답에서 noticeCategories 파싱
// ─────────────────────────────────────────────────────────────

/**
 * 쿠팡 getCategoryMeta 응답의 noticeCategories 배열을 파싱하여
 * 카테고리별 세부항목 그룹 목록으로 반환합니다.
 *
 * 실제 응답 구조:
 *   noticeCategories: [
 *     {
 *       noticeCategoryName: "기타 재화",
 *       noticeCategoryDetailNames: [
 *         { noticeCategoryDetailName: "품명 및 모델명", required: "MANDATORY" },
 *         ...
 *       ]
 *     }
 *   ]
 */
function extractNoticeCategories(raw: Record<string, unknown>): NoticeGroup[] {
  if (!Array.isArray(raw['noticeCategories'])) {
    console.log('[category-notices] noticeCategories 키 없음. 응답 키:', Object.keys(raw));
    return [];
  }

  const categories = raw['noticeCategories'] as RawNoticeCategory[];
  const groups: NoticeGroup[] = [];

  for (const cat of categories) {
    const categoryName = String(cat.noticeCategoryName ?? '').trim();
    if (!categoryName) continue;

    const detailNames: string[] = [];

    if (Array.isArray(cat.noticeCategoryDetailNames)) {
      for (const detail of cat.noticeCategoryDetailNames) {
        const name = String(detail.noticeCategoryDetailName ?? '').trim();
        if (name) detailNames.push(name);
      }
    }

    // 세부항목이 없어도 카테고리명만 있는 경우 포함
    groups.push({ categoryName, detailNames });
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────
// 헬퍼: Claude AI로 고시정보 내용 생성
// ─────────────────────────────────────────────────────────────

async function generateNoticesWithAI(
  productName: string,
  groups: NoticeGroup[],
  productDesc?: string,
  certification?: string,
): Promise<NoticeItem[]> {
  // 카테고리별 세부항목 목록 구성
  const categoryListLines = groups
    .filter((g) => g.detailNames.length > 0)
    .map((g) => {
      const details = g.detailNames.map((d) => `    - ${d}`).join('\n');
      return `  [${g.categoryName}]\n${details}`;
    })
    .join('\n');

  const descLine = productDesc ? `상품 설명: ${productDesc}\n` : '';

  const userPrompt = `상품명: ${productName}
${descLine}
다음은 이 카테고리에서 사용 가능한 고시정보 유형들입니다:
${categoryListLines}

1. 위 목록에서 이 상품에 가장 적합한 고시정보 카테고리를 1개만 선택하세요.
   참고 기준 (목록에 해당 카테고리가 없으면 건너뜀):
   - 선풍기/에어컨/세탁기/냉장고/청소기/가습기/제습기 등 가전 → "가전제품"
   - TV/모니터/스피커/이어폰/헤드폰 등 음향·영상기기 → "가전제품" 또는 "전자제품"
   - 스마트폰/태블릿/노트북/컴퓨터/카메라 → "가전제품" 또는 "전자제품"
   - 화장품/뷰티/스킨케어/헤어케어 → "화장품"
   - 세제/방향제/화학제품/소독제 → "생활화학제품"
   - 의류/신발/가방/패션잡화 → 해당 의류·잡화 카테고리
   - 위 기준에 맞지 않거나 해당 카테고리가 목록에 없을 때 → "기타 재화"
   ※ 반드시 위 [목록]에 있는 카테고리명 중에서만 선택하세요.

2. 선택한 카테고리의 모든 세부 항목에 대해 내용을 작성하세요.

JSON 형식으로만 응답하세요 (다른 텍스트 없이):
[{"categoryName": "카테고리명", "detailName": "세부항목명", "content": "내용"}, ...]

작성 규칙:
${certification
  ? `- KC 인증/인증 관련: "${certification}"\n- 인증번호: "${certification}"`
  : '- KC 인증/인증 관련: "해당사항없음"\n- 인증번호: "해당사항없음"'
}
- 제조국: 중국 (특별히 명시되지 않은 경우)
- 모르는 경우: "상품 상세 참조"
- A/S 책임자 관련 항목: "청연코퍼레이션"
- A/S 전화번호 관련 항목: "010-5169-2357"
- 품명: 상품명 그대로 사용`;

  const text = await callClaude(
    '당신은 쿠팡 판매자를 위해 상품 고시정보(법정 표기사항)를 작성하는 전문가입니다. JSON 형식으로만 응답합니다.',
    userPrompt,
    'haiku',
  );

  // JSON 파싱 (마크다운 코드블록 제거 후 시도)
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // JSON 배열 부분만 추출
  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('AI 응답에서 JSON 배열을 찾을 수 없습니다.');
  }

  const parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1)) as unknown[];

  return parsed
    .filter((item): item is { categoryName: string; detailName: string; content: string } =>
      item !== null &&
      typeof item === 'object' &&
      'categoryName' in item &&
      'detailName' in item &&
      'content' in item,
    )
    .map((item) => ({
      categoryName: String(item.categoryName),
      detailName: String(item.detailName),
      content: String(item.content),
    }));
}

// ─────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 인증 검증
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  // 쿼리 파라미터 파싱
  const params = req.nextUrl.searchParams;
  const categoryCodeStr = params.get('categoryCode')?.trim() ?? '';
  const productName = params.get('productName')?.trim() ?? '';
  const productDesc = params.get('productDesc')?.trim() || undefined;
  const certification = params.get('certification')?.trim() || undefined;

  if (!categoryCodeStr) {
    return NextResponse.json({ error: 'categoryCode가 필요합니다.' }, { status: 400 });
  }

  const categoryCode = Number(categoryCodeStr);
  if (!Number.isFinite(categoryCode) || categoryCode <= 0) {
    return NextResponse.json({ error: 'categoryCode는 유효한 양의 정수여야 합니다.' }, { status: 400 });
  }

  if (!productName) {
    return NextResponse.json({ error: 'productName이 필요합니다.' }, { status: 400 });
  }

  // ── 1. getCategoryMeta 호출 (캐시 우선) ─────────────────────

  let metaData: Record<string, unknown>;
  try {
    const cached = getCachedMeta(categoryCode);
    if (cached) {
      metaData = cached;
    } else {
      metaData = await getCoupangClient().getCategoryMeta(categoryCode);
      setCachedMeta(categoryCode, metaData);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[category-notices] getCategoryMeta 실패:', errMsg);
    return NextResponse.json(
      { error: 'getCategoryMeta 호출 실패', detail: errMsg },
      { status: 502 },
    );
  }

  // ── 2. noticeCategories 파싱 ─────────────────────────────────

  const groups = extractNoticeCategories(metaData);

  if (groups.length === 0 || groups.every((g) => g.detailNames.length === 0)) {
    return NextResponse.json({ notices: [] });
  }

  // ── 3. Claude AI로 고시정보 내용 자동 생성 ──────────────────

  try {
    const notices = await generateNoticesWithAI(productName, groups, productDesc, certification);
    return NextResponse.json({ notices });
  } catch (err) {
    console.error('[category-notices] AI 생성 실패 — fallback 반환:', err);

    // AI 실패 시 첫 번째 카테고리의 항목들만 content 빈 채로 반환
    const firstGroup = groups.find((g) => g.detailNames.length > 0) ?? groups[0];
    const fallback: NoticeItem[] = firstGroup.detailNames.map((detailName) => ({
      categoryName: firstGroup.categoryName,
      detailName,
      content: '',
    }));
    return NextResponse.json({ notices: fallback });
  }
}
