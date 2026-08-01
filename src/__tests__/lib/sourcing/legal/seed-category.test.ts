import { describe, it, expect } from 'vitest';
import {
  classifySeedKeyword,
  findSeedCategoryGroup,
  SEED_CATEGORY_GROUPS,
  type SeedCategoryId,
} from '@/lib/sourcing/legal/seed-category';

/**
 * 픽스처는 지어낸 값이 아니라 실제 배치 데이터다.
 *
 * 2026-07-31 크론이 만든 시드 26건 중 19건이 규제 그룹에 걸렸고, 그 19건과
 * 통과한 7건을 그대로 고정한다. 대조군은 사장의 우선 카테고리(등산·낚시·캠핑·
 * 차량·반려동물 산책) 상품 10건으로, 여기서 하나라도 걸리면 필터가 과차단이다.
 */

/** 걸려야 하는 실측 시드 — [키워드, 기대 그룹] */
const BLOCKED: ReadonlyArray<[string, SeedCategoryId]> = [
  ['자동 급식기', 'electric'],
  ['술뚜껑 그리들팬', 'food'],
  ['진정 스킨케어', 'cosmetic'],
  ['두피 케어 제품', 'cosmetic'],
  ['뷰티 디바이스', 'electric'],
  ['휴대용 선풍기', 'electric'],
  ['캠핑 랜턴', 'electric'],
  ['제로칼로리 음료', 'food'],
  ['비건 립밤', 'cosmetic'],
  ['톤업 선크림', 'cosmetic'],
  ['휴대용 공기청정기', 'electric'],
  ['강아지 진정제', 'food'],
  ['반려동물 영양제', 'food'],
  ['혈당 보조제', 'food'],
  ['수면 영양제', 'food'],
  ['RTD 단백질', 'food'],
  ['저당 간식', 'food'],
  ['말차 클렌징', 'cosmetic'],
  ['피처형 정수기', 'electric'],
];

/** 같은 배치에서 통과한 시드 */
const PASSED = [
  '에어 텐트',
  '냉감 침구',
  '반려동물 장난감',
  '간편 주방용품',
  '반려동물 이동 가방',
  '미니 인테리어 소품',
  '멀티 스틱',
] as const;

/** 과차단 회귀 방지용 대조군 — 사장의 우선 카테고리 상품 */
const CONTROL = [
  '등산 스틱',
  '낚시 받침대',
  '방한 넥워머',
  '반려견 리드줄',
  '캠핑 수납 가방',
  '골프 티',
  '차량용 정리함',
  '주방 앞치마',
  '트레킹 폴',
  '반려동물 배변패드',
] as const;

describe('classifySeedKeyword — 실측 차단 시드', () => {
  it.each(BLOCKED)('%s → %s', (keyword, group) => {
    expect(classifySeedKeyword(keyword)).toContain(group);
  });

  it('실측 26건 중 19건이 걸린다', () => {
    const all = [...BLOCKED.map(([kw]) => kw), ...PASSED];
    expect(all).toHaveLength(26);
    const blocked = all.filter((kw) => classifySeedKeyword(kw).length > 0);
    expect(blocked).toHaveLength(19);
  });
});

describe('classifySeedKeyword — 통과해야 하는 시드', () => {
  it.each(PASSED)('%s은 어느 그룹에도 걸리지 않는다', (keyword) => {
    expect(classifySeedKeyword(keyword)).toEqual([]);
  });
});

describe('classifySeedKeyword — 우선 카테고리 대조군(과차단 회귀 방지)', () => {
  it.each(CONTROL)('%s은 어느 그룹에도 걸리지 않는다', (keyword) => {
    expect(classifySeedKeyword(keyword)).toEqual([]);
  });
});

describe('classifySeedKeyword — 반려동물 예외', () => {
  it('반려동물 장난감은 어린이제품이 아니므로 kids를 건너뛴다', () => {
    expect(classifySeedKeyword('반려동물 장난감')).toEqual([]);
    expect(classifySeedKeyword('강아지 완구')).toEqual([]);
    expect(classifySeedKeyword('고양이 장난감')).toEqual([]);
  });

  it('반려동물 예외는 kids에만 적용한다 — 동물용의약품은 그대로 막는다', () => {
    expect(classifySeedKeyword('강아지 진정제')).toEqual(['food']);
    expect(classifySeedKeyword('반려견 영양제')).toEqual(['food']);
    expect(classifySeedKeyword('반려묘 탈취제')).toEqual(['cosmetic']);
    expect(classifySeedKeyword('고양이 자동 급식기')).toEqual(['electric']);
  });

  it('반려동물 어휘가 없으면 kids가 그대로 걸린다', () => {
    expect(classifySeedKeyword('유아 장난감')).toEqual(['kids']);
    expect(classifySeedKeyword('어린이 우산')).toEqual(['kids']);
  });
});

describe('classifySeedKeyword — 복수 그룹', () => {
  it('여러 그룹에 걸리면 전부 돌려준다', () => {
    expect(classifySeedKeyword('클렌징 도구 세트 비타민 앰플')).toEqual([
      'cosmetic',
      'food',
    ]);
    expect(classifySeedKeyword('유아 세정제')).toEqual(['cosmetic', 'kids']);
  });

  it('반환 순서는 그룹 정의 순서를 따른다', () => {
    expect(classifySeedKeyword('충전식 마스크팩 워머 단백질 유아용')).toEqual([
      'electric',
      'cosmetic',
      'food',
      'kids',
    ]);
  });
});

describe('classifySeedKeyword — 입력 방어', () => {
  it('빈 문자열과 공백은 빈 배열', () => {
    expect(classifySeedKeyword('')).toEqual([]);
    expect(classifySeedKeyword('   ')).toEqual([]);
  });

  it('영문 키워드는 대소문자를 가리지 않는다', () => {
    expect(classifySeedKeyword('led 무드등')).toEqual(['electric']);
    expect(classifySeedKeyword('LED 무드등')).toEqual(['electric']);
  });
});

describe('설계 중 제외한 키워드 — 다시 넣지 말 것', () => {
  it('주방은 키워드가 아니다 (간편 주방용품 오탐)', () => {
    const all = SEED_CATEGORY_GROUPS.flatMap((g) => g.keywords);
    expect(all).not.toContain('주방');
    expect(classifySeedKeyword('간편 주방용품')).toEqual([]);
  });

  it('팬 대신 그리들·프라이팬·냄비를 쓴다 (팬츠 오탐)', () => {
    const all = SEED_CATEGORY_GROUPS.flatMap((g) => g.keywords);
    expect(all).not.toContain('팬');
    expect(classifySeedKeyword('기모 조거팬츠')).toEqual([]);
    expect(classifySeedKeyword('미니 프라이팬')).toEqual(['food']);
  });

  it('차는 키워드가 아니다 (말차 클렌징 오탐)', () => {
    const all = SEED_CATEGORY_GROUPS.flatMap((g) => g.keywords);
    expect(all).not.toContain('차');
    expect(classifySeedKeyword('차량용 방향 거치대')).toEqual([]);
  });
});

describe('SEED_CATEGORY_GROUPS', () => {
  it('네 그룹이 라벨과 사유를 모두 갖는다', () => {
    expect(SEED_CATEGORY_GROUPS.map((g) => g.id)).toEqual([
      'electric',
      'cosmetic',
      'food',
      'kids',
    ]);
    for (const g of SEED_CATEGORY_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.shortLabel.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(g.keywords.length).toBeGreaterThan(0);
    }
  });

  it('findSeedCategoryGroup은 라벨과 필요한 인허가를 돌려준다', () => {
    expect(findSeedCategoryGroup('electric')?.label).toBe('전기·배터리');
    expect(findSeedCategoryGroup('electric')?.reason).toBe(
      'KC 인증 (전기용품안전관리법)',
    );
    expect(findSeedCategoryGroup('kids')?.reason).toBe('어린이제품 KC 인증');
  });
});
