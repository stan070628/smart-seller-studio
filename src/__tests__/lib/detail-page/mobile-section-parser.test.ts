import { describe, it, expect } from 'vitest';
import { mobileContentToSections } from '@/lib/detail-page/section-parser';
import type { MobileDetailPageContent } from '@/lib/ai/prompts/detail-page';

function makeContent(overrides: Partial<MobileDetailPageContent> = {}): MobileDetailPageContent {
  return {
    brandName: '킵틸 KeepTill',
    categoryLabelEn: 'pencil pouch',
    hook: {
      eyebrow: 'Keep Till',
      headline: '완전 오픈 · 넉넉한 수납',
      hashtags: ['#한눈에 보여', '#쉽게 꺼내', '#깔끔하게 정리'],
    },
    points: [
      { pointLabel: 'Point 1', headline: "펼치면 바로 '보이는' 필통", subheadline: '180도 완전 오픈형 구조' },
      { pointLabel: 'Point 2', headline: "펼치면 '박스처럼' 서는 설계", subheadline: '책상 위에서 안정적으로 착!' },
      { pointLabel: '', headline: '넉넉하게', subheadline: '20cm 자·가위도 여유롭게 들어요' },
    ],
    colorOptions: [
      { label: '레드', swatchColor: '#D9442C' },
      { label: '하늘', swatchColor: '#AEDCF0' },
    ],
    specs: [
      { label: '사이즈', value: '20 x 9.5 x 9.5 (cm)' },
      { label: '소재', value: '옥스퍼드 생활방수직물' },
    ],
    warnings: ['세탁기 사용 금지', '직사광선 보관 금지'],
    ctaText: '지금 구매하기',
    ...overrides,
  };
}

const URLS = [
  'https://example.com/0.jpg',
  'https://example.com/1.jpg',
  'https://example.com/2.jpg',
  'https://example.com/3.jpg',
  'https://example.com/4.jpg',
  'https://example.com/5.jpg',
];

describe('mobileContentToSections — 섹션 구성·순서', () => {
  it('brand_header → hero → point×N → image_grid → spec_table → warning → cta 순서로 생성한다', () => {
    const sections = mobileContentToSections(makeContent(), URLS);
    expect(sections.map((s) => s.type)).toEqual([
      'brand_header', 'hero', 'point', 'point', 'point', 'image_grid', 'spec_table', 'warning', 'cta',
    ]);
  });

  it('order가 0부터 연속된 정수로 할당된다', () => {
    const sections = mobileContentToSections(makeContent(), URLS);
    sections.forEach((s, i) => expect(s.order).toBe(i));
  });

  it('brandName이 빈 문자열이면 brand_header를 생략한다', () => {
    const sections = mobileContentToSections(makeContent({ brandName: '' }), URLS);
    expect(sections[0].type).toBe('hero');
  });

  it('hero에 eyebrow와 해시태그 subheadline(이중 공백 결합)을 설정한다', () => {
    const sections = mobileContentToSections(makeContent(), URLS);
    const hero = sections.find((s) => s.type === 'hero')!;
    expect(hero.eyebrow).toBe('Keep Till');
    expect(hero.content).toMatchObject({
      headline: '완전 오픈 · 넉넉한 수납',
      subheadline: '#한눈에 보여  #쉽게 꺼내  #깔끔하게 정리',
    });
  });

  it('headline이 비어 있으면 throw한다', () => {
    const bad = makeContent();
    bad.hook.headline = '  ';
    expect(() => mobileContentToSections(bad, URLS)).toThrow();
  });

  it('specs/warnings가 빈 배열이면 해당 섹션을 생략한다', () => {
    const sections = mobileContentToSections(makeContent({ specs: [], warnings: [] }), URLS);
    expect(sections.some((s) => s.type === 'spec_table')).toBe(false);
    expect(sections.some((s) => s.type === 'warning')).toBe(false);
  });
});

describe('mobileContentToSections — 이미지 배치 규칙', () => {
  it('img[0]→hero, img[1..]→point 순서대로 1장씩, 남는 이미지→image_grid', () => {
    const sections = mobileContentToSections(makeContent(), URLS); // 6장, point 3개
    const hero = sections.find((s) => s.type === 'hero')!;
    const points = sections.filter((s) => s.type === 'point');
    const grid = sections.find((s) => s.type === 'image_grid')!;
    expect(hero.attachedImages[0].url).toBe(URLS[0]);
    expect(points[0].attachedImages[0].url).toBe(URLS[1]);
    expect(points[2].attachedImages[0].url).toBe(URLS[3]);
    expect(grid.attachedImages.map((i) => i.url)).toEqual([URLS[4], URLS[5]]);
  });

  it('이미지 1장이면 hero에만 배치하고 point는 텍스트만 남는다', () => {
    const sections = mobileContentToSections(makeContent({ colorOptions: [] }), [URLS[0]]);
    const points = sections.filter((s) => s.type === 'point');
    expect(points.every((p) => p.attachedImages.length === 0)).toBe(true);
  });

  it('이미지 0장이면 모든 섹션이 텍스트만으로 생성된다', () => {
    const sections = mobileContentToSections(makeContent({ colorOptions: [] }), []);
    expect(sections.every((s) => s.attachedImages.length === 0)).toBe(true);
  });

  it('colorOptions가 비고 남는 이미지가 정확히 1장이면 마지막 point에 추가하고 grid를 생략한다', () => {
    const sections = mobileContentToSections(makeContent({ colorOptions: [] }), URLS.slice(0, 5)); // hero1 + point3 + 잔여1
    const points = sections.filter((s) => s.type === 'point');
    expect(sections.some((s) => s.type === 'image_grid')).toBe(false);
    expect(points[2].attachedImages.map((i) => i.url)).toEqual([URLS[3], URLS[4]]);
  });

  it('colorOptions가 비어도 남는 이미지 2장 이상이면 라벨 없는 image_grid를 생성한다', () => {
    const sections = mobileContentToSections(makeContent({ colorOptions: [] }), URLS); // 잔여 2장
    const grid = sections.find((s) => s.type === 'image_grid')!;
    expect(grid.attachedImages).toHaveLength(2);
    expect((grid.content as { items: unknown[] }).items).toHaveLength(2);
  });

  it('colorOptions도 비고 남는 이미지도 없으면 image_grid를 생략한다', () => {
    const sections = mobileContentToSections(makeContent({ colorOptions: [] }), URLS.slice(0, 4)); // hero1+point3, 잔여0
    expect(sections.some((s) => s.type === 'image_grid')).toBe(false);
  });

  it('colorOptions보다 남는 이미지가 많으면 items를 빈 라벨로 패딩해 모든 이미지를 렌더링 대상으로 만든다', () => {
    // colorOptions 2개, 남는 이미지 3장 (point 2개로 줄여서)
    const content = makeContent({
      points: [
        { pointLabel: 'Point 1', headline: 'A', subheadline: 'a' },
        { pointLabel: 'Point 2', headline: 'B', subheadline: 'b' },
      ],
    });
    const sections = mobileContentToSections(content, URLS); // 6장: hero1 + point2 + 잔여3
    const grid = sections.find((s) => s.type === 'image_grid')!;
    expect(grid.attachedImages).toHaveLength(3);
    expect((grid.content as { items: unknown[] }).items).toHaveLength(3);
  });
});
