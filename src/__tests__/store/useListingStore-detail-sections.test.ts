/**
 * useListingStore-detail-sections.test.ts
 * Task 4에서 추가된 상세페이지 섹션 편집 액션 단위 테스트
 *
 * 대상 액션:
 *   - setDetailPageSections
 *   - setDetailPageTheme
 *   - updateDetailPageSection
 *   - removeDetailPageSection
 *   - reorderDetailPageSections
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListingStore } from '@/store/useListingStore';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

function makeSection(id: string, order: number): DetailSection {
  return {
    id,
    type: 'hero',
    order,
    content: { type: 'hero', headline: `headline-${id}`, subheadline: '' },
    attachedImages: [],
  };
}

/** DEFAULT_THEME 와 다른 대체 테마 (테마 교체 테스트용) */
const ALT_THEME: DetailPageTheme = {
  palette: 'deep_dark',
  primaryColor: '#1A1A1A',
  accentColor: '#FFC107',
  fontStyle: 'sans',
  imageLayout: 'split',
};

// ---------------------------------------------------------------------------
// 스토어 상태 리셋 유틸
// ---------------------------------------------------------------------------

function resetStore() {
  useListingStore.setState({
    sharedDraft: {
      name: '',
      salePrice: '',
      originalPrice: '',
      stock: '999',
      thumbnailImages: [],
      detailImages: [],
      description: '',
      deliveryCharge: '0',
      deliveryChargeType: 'FREE',
      returnCharge: '5000',
      tags: [],
      naverPrice: '',
      coupangPrice: '',
      options: null,
      optionsLoading: false,
      optionsError: null,
      currentStep: 1,
      selectedPlatform: 'both',
      rawImageFiles: [],
      detailImageFiles: [],
      detailPageFullHtml: null,
      detailPageSnippet: null,
      detailPageStatus: 'idle',
      detailPageError: null,
      detailPageSkipped: false,
      costPrice: '',
      targetMarginRate: 20,
      coupangCategoryCode: '',
      coupangCategoryPath: '',
      naverCategoryId: '',
      naverCategoryPath: '',
      detailPageEditStatus: 'idle',
      detailPageEditError: null,
      pickedDetailImages: [],
      detailPageSnippetNaver: null,
      categoryHint: '',
      detailPageSections: [],
      detailPageTheme: DEFAULT_THEME,
    },
    bothRegistration: {
      coupang: { status: 'idle' },
      naver: { status: 'idle' },
    },
    coupangProducts: [],
    coupangNextToken: null,
    naverProducts: [],
    naverTotal: 0,
    naverPage: 1,
    isRegistering: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// setDetailPageSections 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — setDetailPageSections', () => {
  beforeEach(() => {
    resetStore();
  });

  it('빈 배열에서 섹션 2개 세팅 → 배열 길이 2', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('s1', 0),
        makeSection('s2', 1),
      ]);
    });

    expect(result.current.sharedDraft.detailPageSections).toHaveLength(2);
    expect(result.current.sharedDraft.detailPageSections[0].id).toBe('s1');
    expect(result.current.sharedDraft.detailPageSections[1].id).toBe('s2');
  });

  it('기존 섹션 교체 → 이전 섹션 사라짐', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    // 먼저 3개 세팅
    act(() => {
      result.current.setDetailPageSections([
        makeSection('old1', 0),
        makeSection('old2', 1),
        makeSection('old3', 2),
      ]);
    });
    expect(result.current.sharedDraft.detailPageSections).toHaveLength(3);

    // 새 섹션 1개로 교체
    act(() => {
      result.current.setDetailPageSections([makeSection('new1', 0)]);
    });

    // 이전 섹션 3개가 사라지고 새 섹션 1개만 남음
    expect(result.current.sharedDraft.detailPageSections).toHaveLength(1);
    expect(result.current.sharedDraft.detailPageSections[0].id).toBe('new1');
    // 이전 섹션 ID가 없어야 함
    const ids = result.current.sharedDraft.detailPageSections.map((s) => s.id);
    expect(ids).not.toContain('old1');
    expect(ids).not.toContain('old2');
    expect(ids).not.toContain('old3');
  });
});

// ---------------------------------------------------------------------------
// setDetailPageTheme 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — setDetailPageTheme', () => {
  beforeEach(() => {
    resetStore();
  });

  it('테마 전체 교체 확인', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    // 초기값은 DEFAULT_THEME
    expect(result.current.sharedDraft.detailPageTheme.palette).toBe('warm_cream');

    act(() => {
      result.current.setDetailPageTheme(ALT_THEME);
    });

    const theme = result.current.sharedDraft.detailPageTheme;
    expect(theme.palette).toBe('deep_dark');
    expect(theme.primaryColor).toBe('#1A1A1A');
    expect(theme.accentColor).toBe('#FFC107');
    expect(theme.fontStyle).toBe('sans');
    expect(theme.imageLayout).toBe('split');
  });
});

// ---------------------------------------------------------------------------
// updateDetailPageSection 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — updateDetailPageSection', () => {
  beforeEach(() => {
    resetStore();
  });

  it('매칭 섹션 aiInstruction 업데이트, 다른 섹션 변경 없음', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('a', 0),
        makeSection('b', 1),
        makeSection('c', 2),
      ]);
    });

    act(() => {
      result.current.updateDetailPageSection('b', { aiInstruction: '배경을 흰색으로 변경' });
    });

    const sections = result.current.sharedDraft.detailPageSections;
    // 대상 섹션 업데이트 확인
    const sectionB = sections.find((s) => s.id === 'b');
    expect(sectionB?.aiInstruction).toBe('배경을 흰색으로 변경');

    // 다른 섹션은 변경 없음
    const sectionA = sections.find((s) => s.id === 'a');
    const sectionC = sections.find((s) => s.id === 'c');
    expect(sectionA?.aiInstruction).toBeUndefined();
    expect(sectionC?.aiInstruction).toBeUndefined();
    // 섹션 수 유지
    expect(sections).toHaveLength(3);
  });

  it('존재하지 않는 id → 섹션 배열 변경 없음', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('x', 0),
        makeSection('y', 1),
      ]);
    });

    const before = result.current.sharedDraft.detailPageSections;

    act(() => {
      result.current.updateDetailPageSection('does-not-exist', { aiInstruction: '변경 시도' });
    });

    const after = result.current.sharedDraft.detailPageSections;
    // 길이 동일
    expect(after).toHaveLength(before.length);
    // 각 섹션의 내용 변경 없음
    expect(after[0].id).toBe('x');
    expect(after[0].aiInstruction).toBeUndefined();
    expect(after[1].id).toBe('y');
    expect(after[1].aiInstruction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeDetailPageSection 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — removeDetailPageSection', () => {
  beforeEach(() => {
    resetStore();
  });

  it('매칭 섹션 제거, 나머지 유지', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('r1', 0),
        makeSection('r2', 1),
        makeSection('r3', 2),
      ]);
    });

    act(() => {
      result.current.removeDetailPageSection('r2');
    });

    const sections = result.current.sharedDraft.detailPageSections;
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.id)).toEqual(['r1', 'r3']);
    // 제거된 섹션이 없어야 함
    expect(sections.find((s) => s.id === 'r2')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reorderDetailPageSections 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — reorderDetailPageSections', () => {
  beforeEach(() => {
    resetStore();
  });

  it('완전한 ID 목록 → order 값이 인덱스와 일치', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('p1', 0),
        makeSection('p2', 1),
        makeSection('p3', 2),
      ]);
    });

    // p3 → p1 → p2 순서로 재정렬
    act(() => {
      result.current.reorderDetailPageSections(['p3', 'p1', 'p2']);
    });

    const sections = result.current.sharedDraft.detailPageSections;
    expect(sections).toHaveLength(3);
    expect(sections[0].id).toBe('p3');
    expect(sections[0].order).toBe(0);
    expect(sections[1].id).toBe('p1');
    expect(sections[1].order).toBe(1);
    expect(sections[2].id).toBe('p2');
    expect(sections[2].order).toBe(2);
  });

  it('알 수 없는 ID 포함된 목록 → 해당 항목 조용히 무시 (계약 문서화)', () => {
    /**
     * 계약 명세:
     * orderedIds에 현재 detailPageSections에 존재하지 않는 ID가 포함되어 있으면
     * 해당 항목은 결과 배열에서 조용히 제외된다 (에러 없음).
     * 단, order 값은 orderedIds 원배열에서의 인덱스 기준으로 부여되므로
     * ghost ID 뒤에 있는 실존 섹션의 order 값에 간격(gap)이 생긴다.
     *   ['q2', 'ghost-id', 'q1'] → q2.order=0, q1.order=2  (ghost 자리 1은 건너뜀)
     */
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('q1', 0),
        makeSection('q2', 1),
      ]);
    });

    act(() => {
      result.current.reorderDetailPageSections(['q2', 'ghost-id', 'q1']);
    });

    const sections = result.current.sharedDraft.detailPageSections;
    // 실존하는 q2, q1만 남음 — ghost-id는 무시됨
    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe('q2');
    expect(sections[0].order).toBe(0);
    expect(sections[1].id).toBe('q1');
    // ghost-id가 index=1을 점유하므로 q1의 order는 원배열 index 2
    expect(sections[1].order).toBe(2);
  });

  it('부분 ID 목록 (일부 섹션 누락) → 누락된 섹션은 결과에 없음 (현재 동작 명시)', () => {
    /**
     * 현재 동작 명세 (의도적 동작):
     * orderedIds에 포함되지 않은 섹션은 결과 배열에서 누락된다.
     * 즉 부분 ID 목록을 전달하면 나머지 섹션이 조용히 삭제되는 효과가 있다.
     * 이 테스트는 그 동작을 명시적으로 문서화한다.
     *
     * 호출자는 전체 ID 목록을 항상 전달해야 하며,
     * 일부만 전달하는 경우 나머지가 삭제된다는 점을 인지해야 한다.
     */
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.setDetailPageSections([
        makeSection('m1', 0),
        makeSection('m2', 1),
        makeSection('m3', 2),
      ]);
    });

    // m3를 누락한 채로 호출
    act(() => {
      result.current.reorderDetailPageSections(['m2', 'm1']);
    });

    const sections = result.current.sharedDraft.detailPageSections;
    // m3는 orderedIds에 없으므로 결과에 포함되지 않음
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.id)).toEqual(['m2', 'm1']);
    expect(sections.find((s) => s.id === 'm3')).toBeUndefined();
    // order는 인덱스 기준 재부여
    expect(sections[0].order).toBe(0);
    expect(sections[1].order).toBe(1);
  });
});
