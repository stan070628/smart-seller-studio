/**
 * POST /api/sourcing/seed-discover
 * 카테고리 배열을 받아 시드 키워드 분석 파이프라인 실행
 *
 * Gate 0: KC인증·시즌 차단
 * Step 2: 네이버 자동완성 → 검색량(3,000~30,000) → 경쟁상품수(<500)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { fetchSearchVolumes } from '@/lib/naver-ad';
import { NaverShoppingClient } from '@/lib/niche/naver-shopping';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { SeedKeyword } from '@/types/sourcing';

// ── 카테고리 → 시드 키워드 사전 정의 ───────────────────────────────────────
const CATEGORY_SEEDS: Record<string, string[]> = {
  '생활용품': ['수납함', '정리함', '욕실용품', '방향제', '발매트', '소품정리함'],
  '문구/사무': ['파일홀더', '메모지', '필통', '볼펜', '인덱스탭', '바인더'],
  '반려동물': ['배변패드', '강아지간식', '고양이모래', '급수기', '배변봉투'],
  '차량용품': ['차량방향제', '핸들커버', '차량거치대', '세차용품', '차량쓰레기통'],
  '가구/인테리어': ['선반', '수납장', '쿠션', '데코소품', '벽시계', '방향제'],
};

// ── Gate 0: 시즌 한정 키워드 ──────────────────────────────────────────────
const SEASON_KEYWORDS = ['크리스마스', '산타', '설날', '추석', '할로윈', '명절'];

function isSeasonKeyword(kw: string): boolean {
  return SEASON_KEYWORDS.some((s) => kw.includes(s));
}

const requestSchema = z.object({
  categories: z.array(z.string()).min(1).max(5),
  sessionId: z.string().uuid().nullish(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { categories, sessionId } = parsed.data;

  // 환경변수 누락 조기 차단
  const hasNaverAdKeys = !!(
    process.env.NAVER_AD_API_KEY &&
    process.env.NAVER_AD_SECRET_KEY &&
    process.env.NAVER_AD_CUSTOMER_ID
  );
  if (!hasNaverAdKeys) {
    return NextResponse.json(
      { success: false, error: 'Naver Ad API 키가 서버에 설정되지 않았습니다. Vercel 환경변수(NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID)를 추가해 주세요.' },
      { status: 500 },
    );
  }

  try {
    // 1. 카테고리 → 시드 키워드 수집
    const seeds: string[] = categories.flatMap((cat) => CATEGORY_SEEDS[cat] ?? []);
    if (seeds.length === 0) {
      return NextResponse.json({ success: false, error: '매핑된 시드 키워드가 없습니다' }, { status: 400 });
    }

    // 2. 네이버 자동완성 확장
    const naverClient = new NaverShoppingClient();
    const expanded = new Set<string>();
    for (const seed of seeds) {
      const suggestions = await naverClient.getSuggestions(seed).catch(() => [] as string[]);
      suggestions.slice(0, 5).forEach((s) => expanded.add(s));
      expanded.add(seed);
    }

    // 3. Gate 0: 시즌 키워드 제거
    const afterGate0 = [...expanded].filter((kw) => !isSeasonKeyword(kw));
    console.log(`[seed-discover] seeds=${seeds.length} expanded=${expanded.size} afterGate0=${afterGate0.length}`);

    // 4. 검색량 조회 (Naver Ad keywordstool)
    //    - hint 키워드는 공백 없는 시드만 사용 (공백 포함 시 API 400 에러)
    //    - hint 5개당 ~1000개 관련 키워드 반환 → 우리 자동완성 셋과 매칭만 추림
    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const ourSet = new Set(afterGate0.map(normalize));
    const volMap = new Map<string, number>(); // normalized → volume

    const hintSeeds = seeds.map((s) => s.replace(/\s+/g, ''));
    const BATCH = 5;
    for (let i = 0; i < hintSeeds.length; i += BATCH) {
      const batch = hintSeeds.slice(i, i + BATCH);
      const m = await fetchSearchVolumes(batch).catch(() => new Map<string, number>());
      for (const [kw, vol] of m) {
        const n = normalize(kw);
        if (ourSet.has(n) && !volMap.has(n)) volMap.set(n, vol);
      }
      // rate limit 회피: 배치 사이 짧은 지연
      if (i + BATCH < hintSeeds.length) await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`[seed-discover] volMap(자동완성 매칭)=${volMap.size}`);

    const filtered: Array<{ keyword: string; searchVolume: number }> = [];
    for (const kw of afterGate0) {
      const vol = volMap.get(normalize(kw));
      if (vol !== undefined && vol >= 3_000 && vol <= 30_000) {
        filtered.push({ keyword: kw, searchVolume: vol });
      }
    }
    console.log(`[seed-discover] filtered(3k-30k)=${filtered.length}`);

    // 5. 경쟁상품수 조회 (hard 필터 제거 - 노출가능성 점수로 정렬)
    //    네이버 쇼핑 total은 전체 통합 카탈로그라 절대값 임계값이 비현실적
    //    Step 6 점수 산출에서 (검색량/경쟁수) 비율로 정렬됨
    const results: SeedKeyword[] = [];
    for (const kw of filtered.slice(0, 60)) {
      try {
        const search = await naverClient.searchShopping(kw.keyword, 1).catch(() => ({ total: 9999, items: [] }));
        results.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competitorCount: search.total,
          topReviewCount: null,
          marginRate: null,
          seedScore: null,
          seedGrade: null,
          domItemNo: null,
          domItemTitle: null,
          kiprisStatus: 'pending',
          isSelected: false,
          isBlocked: false,
          blockedReason: null,
        });
      } catch {
        // 개별 키워드 실패는 무시
      }
    }

    // 6. 세션 생성 또는 업데이트
    const pool = getSourcingPool();
    let sid = sessionId;
    if (!sid) {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO seed_sessions (user_id, categories, state_json)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, categories, JSON.stringify({ keywords: results })],
      );
      sid = row.rows[0].id;
    } else {
      await pool.query(
        `UPDATE seed_sessions SET state_json = $1, step = 2
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify({ keywords: results }), sid, userId],
      );
    }

    return NextResponse.json({ success: true, data: { sessionId: sid, keywords: results } });
  } catch (err) {
    console.error('[POST /api/sourcing/seed-discover]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
