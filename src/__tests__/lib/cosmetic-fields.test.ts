import { describe, it, expect } from 'vitest';
import { migrateCosmeticFields } from '@/lib/label/cosmetic-fields';

// 확장 이전에 localStorage / label_templates 테이블에 저장된 비누 4종 구조.
// 이 형태로 저장된 값이 확장 후에도 동일한 라벨을 그려야 한다.
const LEGACY_SOAP_FIELDS = {
  collection: 'creamy',
  soap1En: 'Goats Milk with Soya Bean Oil',
  soap1Ko: '고츠 밀크 + 소야 빈 오일',
  soap1Ingredients: '소듐팔메이트, 카프라에락(염소우유)',
  soap2En: 'Peaches and Cream',
  soap2Ko: '피치 앤 크림',
  soap2Ingredients: '소듐팔메이트, 복숭아열매추출물',
  soap3En: 'Lilly Pilly with Wattleseed Extract',
  soap3Ko: '릴리 필리 + 왓틀씨드',
  soap3Ingredients: '소듐팔메이트, 아카시아씨앗추출물',
  soap4En: 'Honey and Milk',
  soap4Ko: '허니 앤 밀크',
  soap4Ingredients: '소듐팔메이트, 멜(꿀)',
  weight: '200 g (건조 중량 약 176~178 g)',
  lotNumber: 'L2026',
  expiryDate: '2029-01',
  importer: '㈜테스트',
  importerAddress: '서울시 강남구',
  phone: '1899-5900',
};

describe('migrateCosmeticFields — 레거시 비누 4종', () => {
  it('soap1~soap4를 items 4개로 옮긴다', () => {
    const result = migrateCosmeticFields(LEGACY_SOAP_FIELDS);

    expect(result.itemCount).toBe(4);
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toEqual({
      en: 'Goats Milk with Soya Bean Oil',
      ko: '고츠 밀크 + 소야 빈 오일',
      ingredients: '소듐팔메이트, 카프라에락(염소우유)',
    });
    expect(result.items[3].ko).toBe('허니 앤 밀크');
  });

  it('하드코딩이던 호주 비누 메타를 값으로 승계한다', () => {
    const result = migrateCosmeticFields(LEGACY_SOAP_FIELDS);

    expect(result.brandHeader).toBe('Australian Botanical');
    expect(result.countryOfOrigin).toBe('호주 (Australia)');
    expect(result.manufacturer).toBe(
      'Australian Botanical Soap · 143 Scanlon Drive, Epping VIC 3076, Australia',
    );
    expect(result.usage).toContain('물에 적셔 거품을 낸 후');
    expect(result.footerNote).toBe('Made in Australia');
  });

  it('공통 정보(내용량·제조번호·책임판매업자)를 그대로 보존한다', () => {
    const result = migrateCosmeticFields(LEGACY_SOAP_FIELDS);

    expect(result.weight).toBe('200 g (건조 중량 약 176~178 g)');
    expect(result.lotNumber).toBe('L2026');
    expect(result.expiryDate).toBe('2029-01');
    expect(result.importer).toBe('㈜테스트');
    expect(result.importerAddress).toBe('서울시 강남구');
    expect(result.phone).toBe('1899-5900');
    expect(result.collection).toBe('creamy');
  });
});

describe('migrateCosmeticFields — 신규 가변 구조', () => {
  const SINGLE_ITEM = {
    collection: 'custom',
    brandHeader: '라비오라',
    collectionLabel: '각질 순삭 보습 관리 팩 레몬 허니',
    optionLabel: '워시오프 팩',
    itemCount: 1,
    items: [{ en: 'Lemon Honey Wash-off Pack', ko: '레몬 허니 워시오프 팩', ingredients: '정제수, 글리세린' }],
    weight: '150 g',
    countryOfOrigin: '대한민국',
    manufacturer: '제조원 미상',
    usage: '적당량을 얼굴에 펴 바르고 10~15분 후 미온수로 헹궈냅니다.',
    caution: '상처 부위에는 사용하지 마십시오.',
    footerNote: 'Made in Korea',
  };

  it('items가 이미 있으면 soap 필드로 덮어쓰지 않는다', () => {
    const result = migrateCosmeticFields(SINGLE_ITEM);

    expect(result.itemCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ko).toBe('레몬 허니 워시오프 팩');
  });

  it('브랜드·제조국·사용방법을 입력값으로 덮어쓴다 (호주 비누 기본값이 새지 않는다)', () => {
    const result = migrateCosmeticFields(SINGLE_ITEM);

    expect(result.brandHeader).toBe('라비오라');
    expect(result.countryOfOrigin).toBe('대한민국');
    expect(result.usage).toBe('적당량을 얼굴에 펴 바르고 10~15분 후 미온수로 헹궈냅니다.');
    expect(result.footerNote).toBe('Made in Korea');
    expect(result.collection).toBe('custom');
  });

  it('itemCount와 items 길이가 어긋나면 items 길이를 따른다', () => {
    const result = migrateCosmeticFields({ ...SINGLE_ITEM, itemCount: 4 });

    expect(result.itemCount).toBe(1);
  });

  it('빈 객체는 비누 4종 기본 골격을 반환한다', () => {
    const result = migrateCosmeticFields({});

    expect(result.itemCount).toBe(4);
    expect(result.brandHeader).toBe('Australian Botanical');
  });
});

describe('migrateCosmeticFields — 글자 크기 배율', () => {
  it('저장된 값이 없으면 배율 1이다 (기존 라벨과 동일한 크기)', () => {
    expect(migrateCosmeticFields({}).fontScale).toBe(1);
    expect(migrateCosmeticFields(LEGACY_SOAP_FIELDS).fontScale).toBe(1);
  });

  it('저장된 배율을 그대로 읽는다', () => {
    expect(migrateCosmeticFields({ fontScale: 1.6 }).fontScale).toBe(1.6);
  });

  it('배율을 0.5~3 범위로 제한한다', () => {
    expect(migrateCosmeticFields({ fontScale: 0.1 }).fontScale).toBe(0.5);
    expect(migrateCosmeticFields({ fontScale: 9 }).fontScale).toBe(3);
  });

  it('숫자가 아닌 값은 1로 되돌린다', () => {
    expect(migrateCosmeticFields({ fontScale: 'abc' }).fontScale).toBe(1);
    expect(migrateCosmeticFields({ fontScale: NaN }).fontScale).toBe(1);
  });
});
