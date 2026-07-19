import { describe, it, expect } from 'vitest';
import { contentToSections, createEmptySection, reorderSections } from '@/lib/detail-page/section-parser';
import type { DetailSection, SectionType } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

function makeFullContent(overrides: Partial<DetailPageContent> = {}): DetailPageContent {
  return {
    headline: '최고의 텀블러',
    subheadline: '365일 차갑게 유지',
    sellingPoints: [
      { icon: '🔥', title: '내열', description: '고온 견딤' },
      { icon: '💧', title: '방수', description: '완전 방수' },
      { icon: '✅', title: '안전', description: '식품 안전 인증' },
    ],
    features: [
      { title: '이중벽', description: '진공 단열' },
      { title: '손잡이', description: '인체공학' },
      { title: '뚜껑', description: '원터치 개폐' },
    ],
    specs: [
      { label: '소재', value: '스테인리스' },
      { label: '용량', value: '500ml' },
    ],
    usageSteps: ['세척 후 사용', '뚜껑 잠금'],
    warnings: ['직사광선 금지', '냉동 금지'],
    ctaText: '지금 구매하기',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// contentToSections
// ---------------------------------------------------------------------------

describe('contentToSections', () => {
  it('유효한 입력 시 DetailSection 배열을 반환한다', () => {
    const sections = contentToSections(makeFullContent());
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('hero 섹션이 항상 첫 번째(order=0)에 위치한다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections[0].type).toBe('hero');
    expect(sections[0].order).toBe(0);
  });

  it('cta 섹션이 항상 마지막에 위치한다', () => {
    const sections = contentToSections(makeFullContent());
    const last = sections[sections.length - 1];
    expect(last.type).toBe('cta');
  });

  it('order 필드가 0부터 연속된 정수로 할당된다', () => {
    const sections = contentToSections(makeFullContent());
    sections.forEach((s, i) => {
      expect(s.order).toBe(i);
    });
  });

  it('hero content에 headline과 subheadline이 매핑된다', () => {
    const content = makeFullContent({ headline: '최고 헤드라인', subheadline: '서브 문구' });
    const sections = contentToSections(content);
    const hero = sections.find((s) => s.type === 'hero');
    expect(hero?.content).toMatchObject({ headline: '최고 헤드라인', subheadline: '서브 문구' });
  });

  it('sellingPoints가 있으면 selling_points 섹션이 생성된다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'selling_points')).toBe(true);
  });

  it('sellingPoints가 빈 배열이면 selling_points 섹션이 생략된다', () => {
    const sections = contentToSections(makeFullContent({ sellingPoints: [] }));
    expect(sections.some((s) => s.type === 'selling_points')).toBe(false);
  });

  it('features가 있으면 features 섹션이 생성된다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'features')).toBe(true);
  });

  it('features가 빈 배열이면 features 섹션이 생략된다', () => {
    const sections = contentToSections(makeFullContent({ features: [] }));
    expect(sections.some((s) => s.type === 'features')).toBe(false);
  });

  it('specs가 있으면 spec_table 섹션이 생성된다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'spec_table')).toBe(true);
  });

  it('specs가 빈 배열이면 spec_table 섹션이 생략된다', () => {
    const sections = contentToSections(makeFullContent({ specs: [] }));
    expect(sections.some((s) => s.type === 'spec_table')).toBe(false);
  });

  it('usageSteps가 있으면 usage_steps 섹션이 생성된다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'usage_steps')).toBe(true);
  });

  it('usageSteps가 빈 배열이면 usage_steps 섹션이 생략된다', () => {
    const sections = contentToSections(makeFullContent({ usageSteps: [] }));
    expect(sections.some((s) => s.type === 'usage_steps')).toBe(false);
  });

  it('warnings가 있으면 warning 섹션이 생성된다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'warning')).toBe(true);
  });

  it('warnings가 빈 배열이면 warning 섹션이 생략된다', () => {
    const sections = contentToSections(makeFullContent({ warnings: [] }));
    expect(sections.some((s) => s.type === 'warning')).toBe(false);
  });

  it('선택적 섹션 모두 비워도 hero와 cta만 포함된 2개 배열을 반환한다', () => {
    const sections = contentToSections(
      makeFullContent({
        sellingPoints: [],
        features: [],
        specs: [],
        usageSteps: [],
        warnings: [],
      }),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].type).toBe('hero');
    expect(sections[1].type).toBe('cta');
  });

  it('cta content에 ctaText가 text로 매핑된다', () => {
    const sections = contentToSections(makeFullContent({ ctaText: '특별 할인 지금 구매' }));
    const cta = sections.find((s) => s.type === 'cta');
    expect(cta?.content).toMatchObject({ text: '특별 할인 지금 구매' });
  });

  it('각 섹션에 id 필드가 존재하며 UUID 형식이다', () => {
    const sections = contentToSections(makeFullContent());
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    sections.forEach((s) => {
      expect(s.id).toMatch(uuidPattern);
    });
  });

  it('각 섹션의 id가 중복되지 않는다', () => {
    const sections = contentToSections(makeFullContent());
    const ids = sections.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('각 섹션의 attachedImages가 빈 배열로 초기화된다', () => {
    const sections = contentToSections(makeFullContent());
    sections.forEach((s) => {
      expect(s.attachedImages).toEqual([]);
    });
  });

  it('headline이 빈 문자열이면 Error를 throw한다', () => {
    expect(() => contentToSections(makeFullContent({ headline: '' }))).toThrow(
      'headline must not be empty',
    );
  });

  it('headline이 공백만 있으면 Error를 throw한다', () => {
    expect(() => contentToSections(makeFullContent({ headline: '   ' }))).toThrow(
      'headline must not be empty',
    );
  });

  it('ctaText가 빈 문자열이면 Error를 throw한다', () => {
    expect(() => contentToSections(makeFullContent({ ctaText: '' }))).toThrow(
      'ctaText must not be empty',
    );
  });

  it('ctaText가 공백만 있으면 Error를 throw한다', () => {
    expect(() => contentToSections(makeFullContent({ ctaText: '   ' }))).toThrow(
      'ctaText must not be empty',
    );
  });

  it('stats 섹션은 contentToSections 결과에 포함되지 않는다', () => {
    const sections = contentToSections(makeFullContent());
    expect(sections.some((s) => s.type === 'stats')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createEmptySection
// ---------------------------------------------------------------------------

describe('createEmptySection', () => {
  const ALL_TYPES: SectionType[] = [
    'hero',
    'selling_points',
    'features',
    'stats',
    'spec_table',
    'usage_steps',
    'warning',
    'cta',
  ];

  ALL_TYPES.forEach((type) => {
    it(`type="${type}" → type과 order 필드가 올바르게 설정된다`, () => {
      const section = createEmptySection(type, 3);
      expect(section.type).toBe(type);
      expect(section.order).toBe(3);
    });
  });

  it('hero 타입의 content는 빈 headline과 subheadline을 가진다', () => {
    const section = createEmptySection('hero', 0);
    expect(section.content).toMatchObject({ type: 'hero', headline: '', subheadline: '' });
  });

  it('selling_points 타입의 content는 빈 points 배열을 가진다', () => {
    const section = createEmptySection('selling_points', 0);
    expect(section.content).toMatchObject({ type: 'selling_points', points: [] });
  });

  it('features 타입의 content는 빈 items 배열을 가진다', () => {
    const section = createEmptySection('features', 0);
    expect(section.content).toMatchObject({ type: 'features', items: [] });
  });

  it('stats 타입의 content는 빈 stats 배열을 가진다', () => {
    const section = createEmptySection('stats', 0);
    expect(section.content).toMatchObject({ type: 'stats', stats: [] });
  });

  it('spec_table 타입의 content는 빈 specs 배열을 가진다', () => {
    const section = createEmptySection('spec_table', 0);
    expect(section.content).toMatchObject({ type: 'spec_table', specs: [] });
  });

  it('usage_steps 타입의 content는 빈 steps 배열을 가진다', () => {
    const section = createEmptySection('usage_steps', 0);
    expect(section.content).toMatchObject({ type: 'usage_steps', steps: [] });
  });

  it('warning 타입의 content는 빈 warnings 배열을 가진다', () => {
    const section = createEmptySection('warning', 0);
    expect(section.content).toMatchObject({ type: 'warning', warnings: [] });
  });

  it('cta 타입의 content는 빈 text 문자열을 가진다', () => {
    const section = createEmptySection('cta', 0);
    expect(section.content).toMatchObject({ type: 'cta', text: '' });
  });

  it('반환된 섹션의 id는 UUID 형식이다', () => {
    const section = createEmptySection('hero', 0);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(section.id).toMatch(uuidPattern);
  });

  it('반환된 섹션의 attachedImages는 빈 배열이다', () => {
    const section = createEmptySection('cta', 5);
    expect(section.attachedImages).toEqual([]);
  });

  it('반환된 섹션의 aiInstruction은 undefined이다', () => {
    const section = createEmptySection('hero', 0);
    expect(section.aiInstruction).toBeUndefined();
  });

  it('호출마다 서로 다른 id를 생성한다', () => {
    const s1 = createEmptySection('hero', 0);
    const s2 = createEmptySection('hero', 0);
    expect(s1.id).not.toBe(s2.id);
  });
});

// ---------------------------------------------------------------------------
// reorderSections
// ---------------------------------------------------------------------------

describe('reorderSections', () => {
  function makeSections(count: number): DetailSection[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `section-${i}`,
      type: 'hero' as SectionType,
      order: count - 1 - i,
      content: { type: 'hero' as const, headline: `H${i}`, subheadline: '' },
      attachedImages: [],
      aiInstruction: undefined,
    }));
  }

  it('order 필드가 0부터 순차적으로 재할당된다', () => {
    const sections = makeSections(3);
    const result = reorderSections(sections);
    result.forEach((s, i) => {
      expect(s.order).toBe(i);
    });
  });

  it('원본 배열이 변경되지 않는다 (불변성)', () => {
    const sections = makeSections(3);
    const originalOrders = sections.map((s) => s.order);
    reorderSections(sections);
    const afterOrders = sections.map((s) => s.order);
    expect(afterOrders).toEqual(originalOrders);
  });

  it('반환된 배열은 원본 배열과 다른 참조이다', () => {
    const sections = makeSections(2);
    const result = reorderSections(sections);
    expect(result).not.toBe(sections);
  });

  it('반환된 배열의 각 요소도 원본 요소와 다른 참조이다 (얕은 복사)', () => {
    const sections = makeSections(2);
    const result = reorderSections(sections);
    result.forEach((s, i) => {
      expect(s).not.toBe(sections[i]);
    });
  });

  it('섹션 수가 유지된다', () => {
    const sections = makeSections(5);
    const result = reorderSections(sections);
    expect(result).toHaveLength(5);
  });

  it('id, type, content 등 order 외 필드는 그대로 유지된다', () => {
    const sections: DetailSection[] = [
      {
        id: 'keep-me',
        type: 'cta',
        order: 99,
        content: { type: 'cta', text: 'Buy Now' },
        attachedImages: [],
        aiInstruction: 'instruction',
      },
    ];
    const result = reorderSections(sections);
    expect(result[0].id).toBe('keep-me');
    expect(result[0].type).toBe('cta');
    expect(result[0].content).toMatchObject({ text: 'Buy Now' });
    expect(result[0].aiInstruction).toBe('instruction');
    expect(result[0].order).toBe(0);
  });

  it('빈 배열 입력 시 빈 배열을 반환한다', () => {
    const result = reorderSections([]);
    expect(result).toEqual([]);
  });

  it('단일 섹션 배열 입력 시 order가 0으로 재할당된다', () => {
    const sections: DetailSection[] = [
      {
        id: 'solo',
        type: 'hero',
        order: 10,
        content: { type: 'hero', headline: 'Solo', subheadline: '' },
        attachedImages: [],
      },
    ];
    const result = reorderSections(sections);
    expect(result[0].order).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 신규 모바일 섹션 타입 (brand_header / point / image_grid)
// ---------------------------------------------------------------------------

describe('createEmptySection — 신규 모바일 타입', () => {
  it('brand_header 빈 섹션을 생성한다', () => {
    const s = createEmptySection('brand_header', 0);
    expect(s.type).toBe('brand_header');
    expect(s.content).toEqual({ type: 'brand_header', brandName: '', rightLabel: '' });
  });

  it('point 빈 섹션을 생성한다', () => {
    const s = createEmptySection('point', 1);
    expect(s.content).toEqual({ type: 'point', pointLabel: '', headline: '', subheadline: '' });
  });

  it('image_grid 빈 섹션을 생성한다', () => {
    const s = createEmptySection('image_grid', 2);
    expect(s.content).toEqual({ type: 'image_grid', title: '', items: [] });
  });
});

describe('createEmptySection youtube', () => {
  it('youtube 기본값', () => {
    const s = createEmptySection('youtube', 3);
    expect(s.type).toBe('youtube');
    expect(s.order).toBe(3);
    expect(s.content).toEqual({ type: 'youtube', url: '', videoId: '', aspect: 'horizontal', enabled: true });
  });
});
