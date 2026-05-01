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
import { fetchKeywordDetails } from '@/lib/naver-ad';
import { NaverShoppingClient } from '@/lib/niche/naver-shopping';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { SeedKeyword } from '@/types/sourcing';

// ── 카테고리 → 시드 키워드 사전 정의 ───────────────────────────────────────
//   원칙: 채널 가이드대로 "2단어 이상 조합"을 시드로 사용
//   ('차량용수납함'은 모키워드 → '차량용수납함 조수석' 같은 2단어 조합이 시드)
//   채널 [잘 팔리는 상품 소싱? 쿠팡, 스마트스토어 키워드 찾는법 (2026-03-10)]
const CATEGORY_SEEDS: Record<string, string[]> = {
  '생활용품': [
    '차량용수납함 조수석', '차량용수납함 뒷자리', '차량용수납함 컵홀더',
    '주방수납함 슬림', '주방수납함 냉장고', '주방수납함 서랍',
    '서랍수납함 옷', '서랍수납함 화장품',
    '캠핑수납함 폴딩', '캠핑수납함 차박',
    '냉장고수납함 슬라이드', '냉장고수납함 소분',
    '욕실수납함 벽걸이', '욕실수납함 코너',
    '신발수납함 슬림', '신발수납함 적층',
    '주방정리함 양념통', '화장대정리함 회전',
    '약정리함 일주일', '약통 휴대용',
    '석고방향제 자동차', '석고방향제 원형', '석고방향제 만들기',
    '디퓨저 자동차', '디퓨저 화장실', '캔들워머 미니',
    '규조토발매트 욕실', '규조토발매트 소형',
    '주방발매트 롱', '현관발매트 야외',
  ],
  '문구/사무': [
    '데스크정리함 회전', '데스크정리함 모니터하단',
    '문서정리함 A4', '문서정리함 책상',
    '서류파일 인덱스', 'A4파일 100매', '클리어파일 100매',
    '명함정리 책장', '독서대 접이식',
    '필기구홀더 회전', '책상매트 가죽',
    '데스크오거나이저 모니터하단',
    '인덱스탭 5색', '하이라이터 형광',
    '리빙박스 슬림', '바인더정리 인덱스',
  ],
  '반려동물': [
    '훈련간식 강아지', '훈련간식 소형견',
    '덴탈간식 강아지', '덴탈간식 알갱이',
    '관절영양제 강아지', '관절영양제 노령견',
    '두부모래 친환경', '두부모래 응고형',
    '벤토나이트모래 무향', '실리카모래 무향',
    '소형견배변패드 압축', '강아지하네스 노견',
    '자동급수기 정수', '자동급식기 무선',
    '캣휠 정숙', '캣타워 원목',
  ],
  '차량용품': [
    '차량핸드폰거치대 무선충전', '차량핸드폰거치대 송풍구',
    '차량컵홀더 보조', '차량쓰레기통 자석',
    '핸들커버 가죽', '핸들커버 디스니',
    '시트커버 사계절', '시트커버 가죽',
    '차량방향제 자동차', '차량방향제 송풍구',
    '디스크워셔 자동차', '트렁크정리함 SUV',
    '차량용청소기 무선', '차량용공기청정기 12V',
    '블랙박스거치대 양면테이프', '하이패스거치대 룸미러',
  ],
  '가구/인테리어': [
    '벽선반 우드', '벽선반 모서리',
    '주방선반 2단', '주방선반 싱크대',
    '욕실선반 코너', '욕실선반 흡착',
    '코너선반 다용도', '미니수납장 옷',
    '슬림수납장 폭20cm', '협탁 1단',
    '서랍장 옷장', '쿠션커버 45x45',
    '바디필로우 임산부', '인형쿠션 캐릭터',
    '디지털시계 침실', '책상시계 디지털',
    '무드등 LED', '무드등 캐릭터',
  ],
};

// ── Gate 0: 시즌 한정 키워드 ──────────────────────────────────────────────
const SEASON_KEYWORDS = ['크리스마스', '산타', '설날', '추석', '할로윈', '명절'];

function isSeasonKeyword(kw: string): boolean {
  return SEASON_KEYWORDS.some((s) => kw.includes(s));
}

const requestSchema = z.object({
  categories: z.array(z.string()).max(5).default([]),
  customSeeds: z.array(z.string().min(1).max(40)).max(20).default([]),
  sessionId: z.string().uuid().nullish(),
}).refine((d) => d.categories.length > 0 || d.customSeeds.length > 0, {
  message: '카테고리 또는 직접 입력 시드 중 최소 하나는 필요합니다',
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

  const { categories, customSeeds, sessionId } = parsed.data;

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
    // 1. 카테고리 default 시드 + 사용자 직접 입력 시드 통합
    const categorySeeds = categories.flatMap((cat) => CATEGORY_SEEDS[cat] ?? []);
    const trimmedCustom = customSeeds.map((s) => s.trim()).filter(Boolean);
    const seeds: string[] = Array.from(new Set([...categorySeeds, ...trimmedCustom]));
    if (seeds.length === 0) {
      return NextResponse.json({ success: false, error: '매핑된 시드 키워드가 없습니다' }, { status: 400 });
    }
    console.log(`[seed-discover] 시드: 카테고리=${categorySeeds.length}, 사용자입력=${trimmedCustom.length}, 합계=${seeds.length}`);

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

    // 4. 검색량 + 경쟁강도(compIdx) + 평균 CTR 조회 (Naver Ad keywordstool)
    //    - hint 키워드는 공백 없는 시드만 사용 (공백 포함 시 API 400 에러)
    //    - hint 5개당 ~1000개 관련 키워드 반환 → 우리 자동완성 셋과 매칭만 추림
    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const ourSet = new Set(afterGate0.map(normalize));
    const detailMap = new Map<string, { vol: number; compIdx: '낮음'|'중간'|'높음'|null; avgCtr: number | null }>();

    const hintSeeds = seeds.map((s) => s.replace(/\s+/g, ''));
    const BATCH = 5;
    for (let i = 0; i < hintSeeds.length; i += BATCH) {
      const batch = hintSeeds.slice(i, i + BATCH);
      const list = await fetchKeywordDetails(batch).catch(() => []);
      for (const d of list) {
        const n = normalize(d.keyword);
        if (ourSet.has(n) && !detailMap.has(n)) {
          detailMap.set(n, { vol: d.searchVolume, compIdx: d.compIdx, avgCtr: d.avgCtr });
        }
      }
      if (i + BATCH < hintSeeds.length) await new Promise((r) => setTimeout(r, 300));
    }
    console.log(`[seed-discover] detailMap(자동완성 매칭)=${detailMap.size}`);

    // 검색량 상한 채널 가이드 반영 (3k~15k가 실제 위너 발굴 분포)
    const filtered: Array<{ keyword: string; searchVolume: number; compIdx: '낮음'|'중간'|'높음'|null; avgCtr: number | null }> = [];
    for (const kw of afterGate0) {
      const d = detailMap.get(normalize(kw));
      if (d && d.vol >= 3_000 && d.vol <= 15_000) {
        filtered.push({ keyword: kw, searchVolume: d.vol, compIdx: d.compIdx, avgCtr: d.avgCtr });
      }
    }
    console.log(`[seed-discover] filtered(3k-15k)=${filtered.length}`);

    // 5. 경쟁상품수 조회 (hard 필터 제거 - 노출가능성 점수로 정렬)
    const results: SeedKeyword[] = [];
    for (const kw of filtered.slice(0, 60)) {
      try {
        const search = await naverClient.searchShopping(kw.keyword, 1).catch(() => ({ total: 9999, items: [] }));
        results.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competitorCount: search.total,
          compIdx: kw.compIdx,
          avgCtr: kw.avgCtr,
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
        [userId, categories, JSON.stringify({ keywords: results, customSeeds: trimmedCustom })],
      );
      sid = row.rows[0].id;
    } else {
      await pool.query(
        `UPDATE seed_sessions SET state_json = $1, step = 2
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify({ keywords: results, customSeeds: trimmedCustom }), sid, userId],
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
