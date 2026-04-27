/**
 * detail-page-html-builder.test.ts
 *
 * buildDetailPageHtml / buildDetailPageSnippet 의 studioMode 분기 테스트
 *
 * RED 기준:
 *  - studioMode 파라미터가 없으면 5번째 인자가 무시되어 두 결과가 동일
 *  - studioMode=true 일 때 스튜디오 전용 템플릿(#f7f8fa 없음, box-shadow 없음)이 적용되어야 한다
 *
 * GREEN 기준:
 *  - buildDetailPageHtml / buildDetailPageSnippet 이 studioMode 파라미터를 받아 서로 다른 HTML 반환
 */

import { describe, it, expect } from 'vitest';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

// ─── 픽스처 ────────────────────────────────────────────────────────────────

const mockContent: DetailPageContent = {
  headline: '테스트 헤드라인',
  subheadline: '테스트 서브헤드라인',
  sellingPoints: [
    { icon: '✨', title: '특장점1', description: '설명1' },
    { icon: '💎', title: '특장점2', description: '설명2' },
    { icon: '🌟', title: '특장점3', description: '설명3' },
  ],
  features: [
    { title: '특징1', description: '특징 설명1' },
    { title: '특징2', description: '특징 설명2' },
    { title: '특징3', description: '특징 설명3' },
  ],
  specs: [
    { label: '소재', value: '면 100%' },
    { label: '색상', value: '블랙' },
  ],
  usageSteps: ['1단계 설명', '2단계 설명'],
  warnings: ['주의사항1', '주의사항2'],
  ctaText: '지금 구매',
};

const mockImages = [
  { imageBase64: 'abc123', mimeType: 'image/jpeg' as const, publicUrl: 'https://example.com/img1.jpg' },
  { imageBase64: 'def456', mimeType: 'image/jpeg' as const, publicUrl: 'https://example.com/img2.jpg' },
];

// ─── 타입 우회 헬퍼 ────────────────────────────────────────────────────────
// studioMode 파라미터가 아직 없는 RED 상태에서도 컴파일·실행되도록 unknown 캐스팅

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuilder = (...args: any[]) => string;

// ─── 테스트 ────────────────────────────────────────────────────────────────

describe('buildDetailPageHtml — studioMode', () => {
  // dynamic import로 항상 최신 모듈을 가져옴
  async function getBuilders() {
    const mod = await import('@/lib/detail-page/html-builder');
    return {
      buildHtml: mod.buildDetailPageHtml as AnyBuilder,
      buildSnippet: mod.buildDetailPageSnippet as AnyBuilder,
    };
  }

  it('studioMode=false 는 셀링포인트에 box-shadow 카드 스타일을 포함한다', async () => {
    const { buildHtml } = await getBuilders();
    const html = buildHtml(mockContent, mockImages, undefined, 780, false);
    expect(html).toContain('box-shadow');
  });

  it('studioMode=true 는 box-shadow를 포함하지 않는다', async () => {
    const { buildHtml } = await getBuilders();
    const html = buildHtml(mockContent, mockImages, undefined, 780, true);
    expect(html).not.toContain('box-shadow');
  });

  it('studioMode=false 는 #f7f8fa 섹션 배경색을 포함한다', async () => {
    const { buildHtml } = await getBuilders();
    const html = buildHtml(mockContent, mockImages, undefined, 780, false);
    expect(html).toContain('#f7f8fa');
  });

  it('studioMode=true 는 #f7f8fa 섹션 배경색을 포함하지 않는다', async () => {
    const { buildHtml } = await getBuilders();
    const html = buildHtml(mockContent, mockImages, undefined, 780, true);
    expect(html).not.toContain('#f7f8fa');
  });

  it('studioMode=true 와 false 는 서로 다른 HTML을 반환한다', async () => {
    const { buildHtml } = await getBuilders();
    const standard = buildHtml(mockContent, mockImages, undefined, 780, false);
    const studio = buildHtml(mockContent, mockImages, undefined, 780, true);
    expect(studio).not.toBe(standard);
  });

  it('studioMode=true 는 letter-spacing 을 포함한다 (미니멀 타이포그래피 신호)', async () => {
    const { buildHtml } = await getBuilders();
    const html = buildHtml(mockContent, mockImages, undefined, 780, true);
    expect(html).toContain('letter-spacing');
  });
});

describe('buildDetailPageSnippet — studioMode', () => {
  async function getSnippet(studioMode: boolean) {
    const mod = await import('@/lib/detail-page/html-builder');
    const build = mod.buildDetailPageSnippet as AnyBuilder;
    return build(mockContent, mockImages, undefined, 780, studioMode);
  }

  it('studioMode=true 와 false 스니펫은 서로 다르다', async () => {
    const standard = await getSnippet(false);
    const studio = await getSnippet(true);
    expect(studio).not.toBe(standard);
  });

  it('studioMode=true 스니펫에는 box-shadow가 없다', async () => {
    const html = await getSnippet(true);
    expect(html).not.toContain('box-shadow');
  });
});
