/**
 * Layer: seed-category
 *
 * 트렌드 시드 키워드의 규제 그룹 분류 — 판매하려면 인허가가 필요한 시드를 골라낸다.
 *
 * trend-discovery.ts의 프롬프트는 이미 전기·화장품·식품·아동용품을 제외하라고
 * 지시하고 선풍기·랜턴을 금지 예시로 명시한다. 그런데도 실제 배치 26건 중
 * 19건이 그 지시를 어겼다(휴대용 선풍기, 캠핑 랜턴 포함). parseSeedResponse는
 * JSON 모양만 검증하고 내용은 보지 않는다.
 * → 프롬프트 지시는 지켜지지 않는다는 것이 실측으로 확인됐으므로, 표시 여부는
 *   코드가 판정한다. 이 모듈은 순수 함수이며 렌더 시점에 브라우저에서 돈다.
 *
 * 차단이 아니라 분류다. 사장이 나중에 인허가를 받을 수 있으므로(캠핑 랜턴의 KC
 * 인증은 우선 카테고리와 겹친다) 시드를 지우지 않고, 화면에서 그룹별로 켜서 볼 수 있게 한다.
 *
 * 【키워드 선정 근거 — 설계 중 뺀 것들. 다시 넣지 말 것】
 * - `주방`: 주방용품이 전부 식품에 닿지는 않는다. 실측 시드 `간편 주방용품`이
 *   오탐이었다. 식품에 직접 닿는 조리·보관 기구만 개별 지정한다.
 * - `팬`: `팬츠`에 걸린다. 그리들 / 프라이팬 / 냄비로 대체했다.
 * - `차`: `말차 클렌징`에 엉뚱하게 걸렸다. 음료는 `음료`로만 잡는다.
 *
 * 키워드 목록은 실측 26건(19건 차단)과 사장의 우선 카테고리 대조군 10건
 * (오탐 0건)으로 검증했다. seed-category.test.ts가 그 데이터를 그대로 고정한다.
 */

export type SeedCategoryId = 'electric' | 'cosmetic' | 'food' | 'kids';

export interface SeedCategoryGroup {
  id: SeedCategoryId;
  /** 화면에 쓰는 정식 라벨 */
  label: string;
  /** 숨김 요약처럼 자리가 좁은 곳에서 쓰는 짧은 라벨 */
  shortLabel: string;
  /** 왜 막히는가 — 필요한 인허가 */
  reason: string;
  keywords: readonly string[];
}

/**
 * 반려동물 예외 어휘.
 *
 * `반려동물 장난감`은 어린이제품이 아니므로 통과해야 한다. 이 예외는 `kids`
 * 그룹에만 적용한다 — `강아지 진정제`는 동물용의약품이라 그대로 막아야 한다.
 */
const PET_TERMS = ['반려동물', '반려견', '반려묘', '강아지', '고양이'] as const;
// '펫'은 뺐다 — '카펫'에 걸려 카펫 관련 아동용품이 kids 판정을 건너뛴다.
// 위 다섯으로 실측 시드와 대조군이 모두 올바르게 갈린다.

export const SEED_CATEGORY_GROUPS: readonly SeedCategoryGroup[] = [
  {
    id: 'electric',
    label: '전기·배터리',
    shortLabel: '전기',
    reason: 'KC 인증 (전기용품안전관리법)',
    keywords: [
      '선풍기', '랜턴', '히터', '조명', '램프', '전구', 'LED',
      // '충전'이 아니라 '충전식'·'충전기'다 — 방한이 우선 카테고리라
      // '패딩 충전재' 같은 비전기 상품이 실제로 나온다.
      '충전식', '충전기', '배터리',
      '전동', '가전', '청정기', '청소기', '정수기', '가습기', '제습기', '급식기',
      '디바이스', '안마기', '마사지기', '드라이어',
    ],
  },
  {
    id: 'cosmetic',
    label: '화장품·위생',
    shortLabel: '화장품',
    reason: '화장품책임판매업 등록',
    keywords: [
      '화장품', '스킨케어', '선크림', '자외선차단', '립밤', '틴트', '클렌징',
      // '쿠션'이 아니라 '쿠션팩트'다 — 차량용품·캠핑이 우선 카테고리라
      // '차량용 쿠션', '캠핑 방석 쿠션'이 걸리면 팔 수 있는 상품을 죽인다.
      '세럼', '토너', '앰플', '마스크팩', '쿠션팩트', '파운데이션', '향수', '세제',
      '세정제', '탈취제', '두피', '헤어케어', '바디로션',
      // '토너'는 '프린터 토너'도 잡는 오탐이 남아 있다. 화장품 토너 키워드가
      // 수식어 없이 '토너'로만 오는 경우가 흔해 좁히지 않았고, 우선 카테고리
      // (골프·낚시·캠핑·차량·반려동물)에 프린터 소모품이 나올 빈도가 낮다고 봤다.
    ],
  },
  {
    id: 'food',
    label: '식품·건기식·의약',
    shortLabel: '식품',
    reason: '식품영업등록 / 건강기능식품판매업',
    keywords: [
      '식품', '음료', '단백질', '간식', '보조제', '영양제', '비타민', '진정제',
      '의약', '도시락', '텀블러', '물병', '수저', '도마', '밀폐용기', '식품용기',
      '그리들', '프라이팬', '냄비', '조리기구',
    ],
  },
  {
    id: 'kids',
    label: '아동·유아',
    shortLabel: '아동',
    reason: '어린이제품 KC 인증',
    keywords: ['유아', '아동', '아기', '어린이', '장난감', '완구'],
  },
] as const;

/** id로 그룹 정의를 찾는다. 없는 id면 undefined */
export function findSeedCategoryGroup(id: SeedCategoryId): SeedCategoryGroup | undefined {
  return SEED_CATEGORY_GROUPS.find((g) => g.id === id);
}

/**
 * 시드 키워드가 속한 규제 그룹을 전부 돌려준다.
 *
 * 부분 문자열 일치다. 한 키워드가 여러 그룹에 걸릴 수 있고(예: 화장품과 식품을
 * 동시에), 그때는 걸린 그룹을 모두 반환한다. 어느 그룹에도 안 걸리면 빈 배열.
 * 반환 순서는 SEED_CATEGORY_GROUPS 정의 순서를 따른다.
 */
export function classifySeedKeyword(keyword: string): SeedCategoryId[] {
  const text = keyword.toLowerCase();
  if (text.trim().length === 0) return [];

  const isPet = PET_TERMS.some((t) => text.includes(t));

  const matched: SeedCategoryId[] = [];
  for (const group of SEED_CATEGORY_GROUPS) {
    // 반려동물 예외는 kids에만 건다. 다른 세 그룹에는 적용하지 않는다.
    if (group.id === 'kids' && isPet) continue;
    if (group.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      matched.push(group.id);
    }
  }
  return matched;
}
