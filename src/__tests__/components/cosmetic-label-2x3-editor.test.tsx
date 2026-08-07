import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CosmeticLabel2x3Editor from '@/components/label/CosmeticLabel2x3Editor';

// 확장 이전 에디터가 localStorage에 남긴 비누 4종 구조
const LEGACY_STORED = {
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

describe('CosmeticLabel2x3Editor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('저장돼 있던 비누 4종 값을 품목 4칸으로 복원한다', async () => {
    localStorage.setItem('sss_label_cosmetic', JSON.stringify(LEGACY_STORED));

    render(<CosmeticLabel2x3Editor />);

    expect(await screen.findByDisplayValue('고츠 밀크 + 소야 빈 오일')).toBeInTheDocument();
    expect(screen.getByDisplayValue('허니 앤 밀크')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L2026')).toBeInTheDocument();
  });

  it('품목 수를 1로 줄이면 품목 입력 섹션이 1개만 남는다', async () => {
    const user = userEvent.setup();
    render(<CosmeticLabel2x3Editor />);

    await user.selectOptions(screen.getByLabelText('품목 수'), '1');

    expect(screen.getByText('품목 1')).toBeInTheDocument();
    expect(screen.queryByText('품목 2')).toBeNull();
    expect(screen.queryByText('품목 4')).toBeNull();
  });

  it('품목 수를 늘리면 빈 품목 칸이 추가된다', async () => {
    const user = userEvent.setup();
    render(<CosmeticLabel2x3Editor />);

    await user.selectOptions(screen.getByLabelText('품목 수'), '1');
    await user.selectOptions(screen.getByLabelText('품목 수'), '2');

    expect(screen.getByText('품목 2')).toBeInTheDocument();
  });

  it('제조번호가 비어 있으면 경고를 표시한다', () => {
    render(<CosmeticLabel2x3Editor />);

    expect(screen.getByRole('alert')).toHaveTextContent('제조번호');
  });

  it('제조번호와 사용기한을 모두 채우면 경고가 사라진다', async () => {
    const user = userEvent.setup();
    render(<CosmeticLabel2x3Editor />);

    await user.type(screen.getByLabelText('제조번호 (LOT)'), '2F078C');
    await user.type(screen.getByLabelText('사용기한 (예: 2026-09)'), '2029.03.09');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('사용기한만 비어 있으면 사용기한을 지목해 경고한다', async () => {
    const user = userEvent.setup();
    render(<CosmeticLabel2x3Editor />);

    await user.type(screen.getByLabelText('제조번호 (LOT)'), '2F078C');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('사용기한');
    expect(alert).not.toHaveTextContent('제조번호');
  });

  it('브랜드·제조국·사용방법을 입력 필드로 노출한다', () => {
    render(<CosmeticLabel2x3Editor />);

    expect(screen.getByLabelText('브랜드 (헤더)')).toBeInTheDocument();
    expect(screen.getByLabelText('제조국')).toBeInTheDocument();
    expect(screen.getByLabelText('제조원')).toBeInTheDocument();
    expect(screen.getByLabelText('사용방법')).toBeInTheDocument();
    expect(screen.getByLabelText('사용 시 주의사항')).toBeInTheDocument();
  });
});
