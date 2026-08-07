import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CosmeticLabel2x3Preview from '@/components/label/CosmeticLabel2x3Preview';
import { migrateCosmeticFields } from '@/lib/label/cosmetic-fields';

// A4 한 장에 라벨 6칸이 반복되므로, 셀 안의 텍스트는 항상 6번 나타난다.
const CELLS = 6;

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

const SINGLE_ITEM_FIELDS = {
  collection: 'custom',
  brandHeader: '라비오라',
  collectionLabel: '각질 순삭 보습 관리 팩 레몬 허니',
  optionLabel: '워시오프 팩 · 1개입',
  items: [
    {
      en: 'Lemon Honey Wash-off Pack',
      ko: '레몬 허니 워시오프 팩',
      ingredients: '정제수, 글리세린, 레몬추출물',
    },
  ],
  weight: '150 g',
  lotNumber: 'LOT-TEST',
  expiryDate: '2028-12',
  expiryNote: '또는 개봉 후 12개월',
  countryOfOrigin: '대한민국',
  manufacturer: '테스트제조㈜ · 경기도 어딘가',
  usage: '적당량을 얼굴에 펴 바르고 10~15분 후 미온수로 헹궈냅니다.',
  caution: '상처 부위에는 사용하지 마십시오.',
  importer: '㈜소분판매자',
  importerAddress: '서울시 어딘가',
  phone: '010-0000-0000',
  footerNote: 'Made in Korea',
};

describe('CosmeticLabel2x3Preview — 레거시 비누 4종 회귀', () => {
  it('품목 4종의 한국명을 모두 렌더한다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(LEGACY_SOAP_FIELDS)} />);

    expect(screen.getAllByText('고츠 밀크 + 소야 빈 오일')).toHaveLength(CELLS);
    expect(screen.getAllByText('허니 앤 밀크')).toHaveLength(CELLS);
  });

  it('브랜드 헤더·제조국·컬렉션 문구가 확장 전과 같다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(LEGACY_SOAP_FIELDS)} />);

    expect(screen.getAllByText('Australian Botanical')).toHaveLength(CELLS);
    expect(screen.getAllByText('크리미 컬렉션 Variety Pack 4종')).toHaveLength(CELLS);
    expect(screen.getAllByText('호주 (Australia)')).toHaveLength(CELLS);
    expect(screen.getAllByText(/물에 적셔 거품을 낸 후/)).toHaveLength(CELLS);
  });

  it('id="cosmetic-label-2x3-preview" 요소를 렌더한다 (인쇄/PDF 대상)', () => {
    const { container } = render(
      <CosmeticLabel2x3Preview fields={migrateCosmeticFields(LEGACY_SOAP_FIELDS)} />,
    );
    expect(container.querySelector('#cosmetic-label-2x3-preview')).not.toBeNull();
  });
});

describe('CosmeticLabel2x3Preview — 단일 품목', () => {
  it('품목 칸을 1개만 렌더한다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(SINGLE_ITEM_FIELDS)} />);

    expect(screen.getAllByText('레몬 허니 워시오프 팩')).toHaveLength(CELLS);
    // 전성분 라벨이 품목 수만큼만 나온다 — 4칸 골격이 남아 있으면 24개가 된다
    expect(screen.getAllByText('전성분')).toHaveLength(CELLS);
  });

  it('호주 비누 하드코딩이 새어 나오지 않는다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(SINGLE_ITEM_FIELDS)} />);

    expect(screen.queryByText('Australian Botanical')).toBeNull();
    expect(screen.queryByText('호주 (Australia)')).toBeNull();
    expect(screen.queryByText(/물에 적셔 거품을 낸 후/)).toBeNull();
    expect(screen.queryByText(/Made in Australia/)).toBeNull();
  });

  it('입력한 브랜드·제조국·사용방법·내용량을 표시한다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(SINGLE_ITEM_FIELDS)} />);

    expect(screen.getAllByText('라비오라')).toHaveLength(CELLS);
    expect(screen.getAllByText('각질 순삭 보습 관리 팩 레몬 허니')).toHaveLength(CELLS);
    expect(screen.getAllByText('대한민국')).toHaveLength(CELLS);
    expect(screen.getAllByText('150 g')).toHaveLength(CELLS);
    expect(screen.getAllByText(/10~15분 후 미온수로/)).toHaveLength(CELLS);
  });

  it('글자 크기 배율을 올리면 전성분·주의사항 글자가 그만큼 커진다', () => {
    const base = migrateCosmeticFields(SINGLE_ITEM_FIELDS);
    const { unmount } = render(<CosmeticLabel2x3Preview fields={base} />);
    const before = screen.getAllByText(/정제수, 글리세린/)[0].style.fontSize;
    const cautionBefore = screen.getAllByText(/상처 부위에는/)[0].style.fontSize;
    unmount();

    render(<CosmeticLabel2x3Preview fields={{ ...base, fontScale: 2 }} />);
    const after = screen.getAllByText(/정제수, 글리세린/)[0].style.fontSize;
    const cautionAfter = screen.getAllByText(/상처 부위에는/)[0].style.fontSize;

    expect(parseFloat(after)).toBeCloseTo(parseFloat(before) * 2, 2);
    expect(parseFloat(cautionAfter)).toBeCloseTo(parseFloat(cautionBefore) * 2, 2);
  });

  it('배율 1은 확장 전과 같은 글자 크기를 유지한다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(LEGACY_SOAP_FIELDS)} />);

    expect(screen.getAllByText(/카프라에락/)[0].style.fontSize).toBe('4.8pt');
  });

  it('사용기한 뒤에 개봉 후 사용기간 문구를 붙인다', () => {
    render(<CosmeticLabel2x3Preview fields={migrateCosmeticFields(SINGLE_ITEM_FIELDS)} />);

    expect(screen.getAllByText('2028-12 또는 개봉 후 12개월')).toHaveLength(CELLS);
  });
});
