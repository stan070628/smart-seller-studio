# 모바일 상세페이지 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일(쿠팡) 상세페이지 AI 생성 파이프라인에 히어로 전체폭 이미지 + 비교 섹션 + 후기 섹션을 추가하고 brand_header 미생성 버그를 수정한다.

**Architecture:** `types/detail-page.ts`에 `ComparisonContent`·`ReviewsContent` 타입 추가 → AI 프롬프트 스키마 확장 + 파서 업데이트 → 섹션 파서(`mobileContentToSections`) 업데이트 → 렌더러에 새 섹션 함수 추가 및 히어로 C 스타일로 교체. 기존 데스크톱 경로는 건드리지 않는다.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, inline HTML (쿠팡 상세페이지 제약)

**Spec:** `docs/superpowers/specs/2026-06-20-mobile-detail-page-hero-comparison-reviews.md`

---

## 파일 맵

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/types/detail-page.ts` | 수정 | `ComparisonContent`, `ReviewsContent` 추가, `SectionType`·`SectionContent` 유니언 확장, 타입 가드 추가 |
| `src/lib/ai/prompts/detail-page.ts` | 수정 | `MobileDetailPageContent` 인터페이스 확장, `MOBILE_DETAIL_PAGE_SYSTEM_PROMPT` JSON 스키마 변경, `parseMobileDetailPageResponse` 업데이트, `SECTION_TYPE_HINTS` 추가 |
| `src/app/api/ai/generate-detail-html/route.ts` | 수정 | brandName 폴백 (파싱 직후) |
| `src/lib/detail-page/section-parser.ts` | 수정 | `mobileContentToSections` 업데이트 (comparison·reviews 섹션 추가, 이미지 배분 수정), `createEmptySection` 케이스 추가 |
| `src/lib/detail-page/section-renderer.ts` | 수정 | `renderMobileHero` C 스타일, `renderComparison`·`renderReviews` 신규, `SECTION_LABELS`·`renderSection` switch 확장 |
| `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts` | 수정 | `renderMobileHero`·`renderComparison`·`renderReviews` 테스트 추가 |
| `src/__tests__/lib/detail-page/mobile-section-parser.test.ts` | 수정 | `makeContent()` 헬퍼 + 순서 기대값 업데이트, comparison·reviews 케이스 추가 |
| `src/__tests__/lib/detail-page-prompts.test.ts` | 수정 | `makeMobileJson()` 헬퍼 + comparison·reviews 파서 테스트 추가 |

---

## Task 1: 타입 시스템 확장

**Files:**
- Modify: `src/types/detail-page.ts`

- [ ] **Step 1: `SectionType`에 두 타입 추가 + `ComparisonContent`·`ReviewsContent` 인터페이스 작성**

`src/types/detail-page.ts`의 `SectionType` 라인을 찾아 아래처럼 수정:

```typescript
export type SectionType =
  | 'hero'
  | 'selling_points'
  | 'features'
  | 'stats'
  | 'spec_table'
  | 'usage_steps'
  | 'warning'
  | 'cta'
  | 'brand_header'
  | 'point'
  | 'image_grid'
  | 'comparison'
  | 'reviews';
```

`ImageGridContent` 인터페이스 아래에 다음 두 인터페이스를 추가:

```typescript
export interface ComparisonContent {
  type: 'comparison';
  painPoint: string;
  counterClaim: string;
  items: Array<{
    label: string;
    theirValue: string;
    ourValue: string;
  }>;
}

export interface ReviewsContent {
  type: 'reviews';
  title: string;
  eyebrow: string;
  items: Array<{
    rating: number;
    text: string;
  }>;
}
```

`SectionContent` 유니언 타입에 두 타입 추가:

```typescript
export type SectionContent =
  | HeroContent
  | SellingPointsContent
  | FeaturesContent
  | StatsContent
  | SpecTableContent
  | UsageStepsContent
  | WarningContent
  | CtaContent
  | BrandHeaderContent
  | PointContent
  | ImageGridContent
  | ComparisonContent
  | ReviewsContent;
```

파일 하단 타입 가드 섹션에 추가:

```typescript
export function isComparisonContent(c: SectionContent): c is ComparisonContent {
  return c.type === 'comparison';
}
export function isReviewsContent(c: SectionContent): c is ReviewsContent {
  return c.type === 'reviews';
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): ComparisonContent·ReviewsContent 섹션 타입 추가"
```

---

## Task 2: 렌더러 기반 연결 (SECTION_LABELS + switch 스텁)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`

타입 추가 후 TypeScript가 `SECTION_LABELS`와 `renderSection` switch에서 오류를 낸다. 스텁으로 먼저 연결한다.

- [ ] **Step 1: `SECTION_LABELS`에 두 항목 추가**

`section-renderer.ts`의 `SECTION_LABELS` 객체에 추가:

```typescript
const SECTION_LABELS: Record<DetailSection['type'], string> = {
  hero: '히어로',
  selling_points: '셀링 포인트',
  features: '특징',
  stats: '통계',
  spec_table: '사양 테이블',
  usage_steps: '사용법',
  warning: '주의사항',
  cta: '구매 유도',
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
  comparison: '비교',       // ← 추가
  reviews: '후기',          // ← 추가
};
```

- [ ] **Step 2: import 타입 확장**

파일 상단 import 블록에 `ComparisonContent`·`ReviewsContent` 추가:

```typescript
import type {
  DetailSection,
  DetailPageTheme,
  ImageLayout,
  HeroContent,
  SellingPointsContent,
  FeaturesContent,
  StatsContent,
  SpecTableContent,
  UsageStepsContent,
  WarningContent,
  CtaContent,
  BrandHeaderContent,
  PointContent,
  ImageGridContent,
  ComparisonContent,   // ← 추가
  ReviewsContent,      // ← 추가
} from '@/types/detail-page';
```

- [ ] **Step 3: `renderSection` switch에 스텁 케이스 추가**

`renderSection` 함수 switch 문에 추가 (실제 함수는 다음 Task에서 구현):

```typescript
case 'comparison':
  return renderComparison(section.content as ComparisonContent, section, colors);
case 'reviews':
  return renderReviews(section.content as ReviewsContent, section, colors);
```

그리고 `renderImageGrid` 아래에 임시 스텁 함수 추가 (다음 Task에서 실제 구현으로 교체):

```typescript
function renderComparison(_content: ComparisonContent, _section: DetailSection, _colors: PaletteColors): string {
  return '';
}

function renderReviews(_content: ReviewsContent, _section: DetailSection, _colors: PaletteColors): string {
  return '';
}
```

- [ ] **Step 4: 빌드 오류 없음 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts
git commit -m "feat(renderer): comparison·reviews 섹션 타입 연결 스텁"
```

---

## Task 3: renderMobileHero C 스타일 (TDD)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Modify: `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`mobile-section-renderer.test.ts`의 기존 `describe('renderSection — point', ...)` 블록 앞에 다음 describe 블록 추가:

```typescript
describe('renderSection — mobile hero (C 스타일)', () => {
  it('이미지가 있으면 position:relative 컨테이너 + 이미지 먼저 + position:absolute 오버레이 순서로 렌더링한다', () => {
    const section = makeSection({
      type: 'hero',
      content: { type: 'hero', headline: '무소음 · 무향', subheadline: '#한눈에 보여  #쉽게 꺼내  #깔끔하게' },
      attachedImages: [{ url: 'https://example.com/hero.jpg', order: 0, processingMode: 'original' }],
      eyebrow: 'KeepTill',
    });
    const html = renderSection(section, MOBILE_THEME);

    // 전체폭 이미지 컨테이너
    expect(html).toContain('position:relative');
    // 이미지가 DOM에서 오버레이보다 앞에 위치
    const imgIdx = html.indexOf('<img');
    const overlayIdx = html.indexOf('position:absolute');
    expect(imgIdx).toBeGreaterThan(-1);
    expect(overlayIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeLessThan(overlayIdx);
    // 텍스트가 오버레이 안에 포함
    expect(html).toContain('무소음 · 무향');
    expect(html).toContain('hero.jpg');
    // 이미지 아래에 별도 이미지 블록 없음 (기존 방식 패딩 박스 없음)
    expect(html).not.toContain('padding:32px 20px 24px');
  });

  it('eyebrow가 있으면 오버레이 안에 필기체 스타일로 포함된다', () => {
    const section = makeSection({
      type: 'hero',
      content: { type: 'hero', headline: '테스트', subheadline: '#해시태그' },
      attachedImages: [{ url: 'https://example.com/img.jpg', order: 0, processingMode: 'original' }],
      eyebrow: 'MyBrand',
    });
    const html = renderSection(section, MOBILE_THEME);
    expect(html).toContain('MyBrand');
    expect(html).toContain('cursive');
  });

  it('이미지가 없으면 기존 텍스트 패딩 박스 스타일로 폴백한다', () => {
    const section = makeSection({
      type: 'hero',
      content: { type: 'hero', headline: '무소음 · 무향', subheadline: '#한눈에 보여' },
      attachedImages: [],
      eyebrow: 'KeepTill',
    });
    const html = renderSection(section, MOBILE_THEME);
    expect(html).not.toContain('position:relative');
    expect(html).toContain('무소음 · 무향');
  });

  it('해시태그 subheadline은 word-spacing 스타일로 렌더링한다', () => {
    const section = makeSection({
      type: 'hero',
      content: { type: 'hero', headline: '제목', subheadline: '#해시1  #해시2  #해시3' },
      attachedImages: [{ url: 'https://example.com/img.jpg', order: 0, processingMode: 'original' }],
    });
    const html = renderSection(section, MOBILE_THEME);
    expect(html).toContain('word-spacing');
    expect(html).toContain('#해시1');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: 새 describe 블록 4개 FAIL (기존 테스트는 PASS 유지)

- [ ] **Step 3: `renderMobileHero` 함수 교체**

`section-renderer.ts`의 기존 `renderMobileHero` 함수 전체를 아래로 교체:

```typescript
function renderMobileHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const sub = content.subheadline.trim();
  const isHashtag = sub.startsWith('#');

  // 이미지가 있으면 C 스타일: 전체폭 이미지 + 상단 반투명 텍스트 패널 오버레이
  if (section.attachedImages.length > 0) {
    const safeUrl = sanitizeUrl(section.attachedImages[0].url);
    if (safeUrl) {
      const eyebrowHtml = section.eyebrow
        ? `<div style="font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:18px;color:rgba(255,255,255,0.9);margin-bottom:8px;">${escapeHtml(section.eyebrow)}</div>`
        : '';
      const subHtml = isHashtag
        ? `<div><span data-edit-path="content.subheadline" style="font-size:15px;font-weight:700;color:rgba(255,255,255,0.9);word-spacing:10px;line-height:1.8;">${escapeHtml(sub)}</span></div>`
        : `<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.85);line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, 'rgba(255,255,255,0.7)')}</p>`;
      return `<div ${sectionAttrs(section)} style="position:relative;width:100%;overflow:hidden;line-height:0;box-sizing:border-box;">
  <img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;" />
  <div style="position:absolute;top:0;left:0;right:0;background:rgba(0,0,0,0.45);padding:20px;text-align:center;line-height:1.4;box-sizing:border-box;">
    ${eyebrowHtml}
    <h1 style="margin:0 0 10px;font-size:30px;font-weight:800;color:#fff;letter-spacing:-1px;line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.5)${headingFont};">${editableText('content.headline', content.headline)}</h1>
    ${subHtml}
  </div>
</div>`;
    }
  }

  // 이미지 없을 때: 텍스트 패딩 박스 폴백
  const eyebrowFallbackHtml = section.eyebrow
    ? `<div style="font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:22px;color:${colors.labelColor};margin-bottom:10px;">${escapeHtml(section.eyebrow)}</div>`
    : '';
  const subFallbackHtml = isHashtag
    ? `<div style="text-align:center;"><span data-edit-path="content.subheadline" style="font-size:18px;font-weight:700;color:${colors.text};word-spacing:12px;line-height:1.8;">${escapeHtml(sub)}</span></div>`
    : `<p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>`;
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:32px 20px 24px;text-align:center;box-sizing:border-box;">
  ${eyebrowFallbackHtml}
  <h1 style="margin:0 0 14px;font-size:34px;font-weight:800;color:${colors.text};letter-spacing:-1px;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h1>
  ${subFallbackHtml}
</div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
git commit -m "feat(renderer): renderMobileHero C 스타일 — 전체폭 이미지 + 상단 텍스트 패널"
```

---

## Task 4: renderComparison 구현 (TDD)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Modify: `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`mobile-section-renderer.test.ts` 하단에 추가:

```typescript
describe('renderSection — comparison', () => {
  const compContent: import('@/types/detail-page').ComparisonContent = {
    type: 'comparison',
    painPoint: '기존 제품은 소음이 심한데 불편하지 않으셨나요?',
    counterClaim: '이 제품은 그럴 일 없습니다 ✓',
    items: [
      { label: '소음', theirValue: '있음', ourValue: '없음' },
      { label: '향', theirValue: '강함', ourValue: '무향' },
    ],
  };

  it('painPoint, counterClaim, 비교 항목을 렌더링한다', () => {
    const html = renderSection(makeSection({ type: 'comparison', content: compContent }), MOBILE_THEME);
    expect(html).toContain('기존 제품은 소음이 심한데');
    expect(html).toContain('이 제품은 그럴 일 없습니다');
    expect(html).toContain('소음');
    expect(html).toContain('있음');
    expect(html).toContain('없음');
    expect(html).toContain('data-section-type="comparison"');
  });

  it('기존 값은 빨간색, 이 제품 값은 accent 색으로 렌더링한다', () => {
    const html = renderSection(makeSection({ type: 'comparison', content: compContent }), MOBILE_THEME);
    expect(html).toContain('#e44');      // 기존 제품 색상
    expect(html).toContain(PALETTES['warm_cream'].accent); // 이 제품 accent
  });

  it('attachedImages가 2장 이상이면 좌우 이미지를 렌더링한다', () => {
    const section = makeSection({
      type: 'comparison',
      content: compContent,
      attachedImages: [
        { url: 'https://example.com/before.jpg', order: 0, processingMode: 'original' },
        { url: 'https://example.com/after.jpg', order: 1, processingMode: 'original' },
      ],
    });
    const html = renderSection(section, MOBILE_THEME);
    expect(html).toContain('before.jpg');
    expect(html).toContain('after.jpg');
    expect(html).toContain('기존');
    expect(html).toContain('이 제품');
  });

  it('attachedImages가 1장 이하이면 이미지 영역을 렌더링하지 않는다', () => {
    const html = renderSection(makeSection({ type: 'comparison', content: compContent }), MOBILE_THEME);
    expect(html).not.toContain('before.jpg');
    expect(html).not.toContain('after.jpg');
  });

  it('HTML 특수문자를 이스케이프한다', () => {
    const xss: import('@/types/detail-page').ComparisonContent = {
      type: 'comparison',
      painPoint: '<script>alert(1)</script>',
      counterClaim: '정상',
      items: [{ label: '<b>항목</b>', theirValue: '나쁨', ourValue: '좋음' }],
    };
    const html = renderSection(makeSection({ type: 'comparison', content: xss }), MOBILE_THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: comparison describe 블록 FAIL (스텁이 빈 문자열 반환 중)

- [ ] **Step 3: `renderComparison` 스텁을 실제 구현으로 교체**

`section-renderer.ts`의 `renderComparison` 스텁을 아래 구현으로 교체:

```typescript
function renderComparison(content: ComparisonContent, section: DetailSection, colors: PaletteColors): string {
  const rowsHtml = content.items.map((item, i) => `<tr${i % 2 !== 0 ? ` style="background-color:${colors.bgAlt};"` : ''}>
  <td style="padding:10px 8px;font-size:14px;color:${colors.textSub};font-weight:600;border-bottom:1px solid ${colors.border};word-break:break-word;">${editableText(`content.items.${i}.label`, item.label)}</td>
  <td style="padding:10px 8px;font-size:14px;color:#e44;text-align:center;border-bottom:1px solid ${colors.border};word-break:break-word;">${editableText(`content.items.${i}.theirValue`, item.theirValue)}</td>
  <td style="padding:10px 8px;font-size:14px;color:${colors.accent};font-weight:700;text-align:center;border-bottom:1px solid ${colors.border};word-break:break-word;">${editableText(`content.items.${i}.ourValue`, item.ourValue)} ✓</td>
</tr>`).join('\n');

  const hasImages = section.attachedImages.length >= 2;
  const imageHtml = hasImages ? (() => {
    const url1 = sanitizeUrl(section.attachedImages[0].url);
    const url2 = sanitizeUrl(section.attachedImages[1].url);
    const imgBlock = (url: string, label: string) =>
      url ? `<div style="flex:1;position:relative;line-height:0;"><img src="${escapeHtml(url)}" alt="" style="width:100%;display:block;" /><div style="position:absolute;bottom:0;left:0;right:0;text-align:center;background:rgba(0,0,0,0.5);padding:6px;font-size:12px;color:#fff;line-height:1.4;">${label}</div></div>` : '';
    return `<div style="display:flex;gap:0;margin-top:20px;">${imgBlock(url1, '기존')}${imgBlock(url2, '이 제품')}</div>`;
  })() : '';

  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:28px 20px ${hasImages ? '0' : '28px'};box-sizing:border-box;">
  <p style="font-size:14px;color:${colors.textSub};margin:0 0 8px;line-height:1.5;">${editableText('content.painPoint', content.painPoint)}</p>
  <h2 style="font-size:22px;font-weight:900;color:${colors.accent};margin:0 0 20px;line-height:1.3;">${editableText('content.counterClaim', content.counterClaim)}</h2>
  <table style="width:100%;border-collapse:collapse;">
    <tr style="background-color:${colors.bgAlt};">
      <th style="padding:10px 8px;font-size:12px;font-weight:600;color:${colors.textSub};text-align:left;width:36%;">항목</th>
      <th style="padding:10px 8px;font-size:12px;color:#aaa;text-align:center;width:32%;">기존</th>
      <th style="padding:10px 8px;font-size:12px;color:${colors.accent};font-weight:700;text-align:center;width:32%;">이 제품 ✓</th>
    </tr>
    ${rowsHtml}
  </table>
  ${imageHtml}
</div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
git commit -m "feat(renderer): renderComparison 신규 — 페인포인트·비교표·이미지"
```

---

## Task 5: renderReviews 구현 (TDD)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Modify: `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`mobile-section-renderer.test.ts` 하단에 추가:

```typescript
describe('renderSection — reviews', () => {
  const revContent: import('@/types/detail-page').ReviewsContent = {
    type: 'reviews',
    title: '고객님들의 100% 리얼 후기',
    eyebrow: '피치 필통, 연말 선물로도!',
    items: [
      { rating: 5, text: '촉촉하게 발리고 향도 없어서 너무 좋아요. 재구매 예정!' },
      { rating: 5, text: '소음도 없고 사용감이 정말 편해요.' },
    ],
  };

  it('타이틀, eyebrow, 후기 텍스트를 렌더링한다', () => {
    const html = renderSection(makeSection({ type: 'reviews', content: revContent }), MOBILE_THEME);
    expect(html).toContain('고객님들의 100% 리얼 후기');
    expect(html).toContain('피치 필통, 연말 선물로도!');
    expect(html).toContain('촉촉하게 발리고');
    expect(html).toContain('소음도 없고');
    expect(html).toContain('data-section-type="reviews"');
  });

  it('각 후기 카드에 별점 ★을 표시한다', () => {
    const html = renderSection(makeSection({ type: 'reviews', content: revContent }), MOBILE_THEME);
    expect(html.match(/★/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('각 카드에 accent 색 상단 보더가 있다', () => {
    const html = renderSection(makeSection({ type: 'reviews', content: revContent }), MOBILE_THEME);
    expect(html).toContain(`border-top:4px solid ${PALETTES['warm_cream'].accent}`);
  });

  it('eyebrow가 비어 있으면 eyebrow 영역을 렌더링하지 않는다', () => {
    const noEyebrow: import('@/types/detail-page').ReviewsContent = { ...revContent, eyebrow: '' };
    const html = renderSection(makeSection({ type: 'reviews', content: noEyebrow }), MOBILE_THEME);
    expect(html).not.toContain('피치 필통');
  });

  it('rating이 1~5 범위를 벗어나도 안전하게 클램핑한다', () => {
    const edgeContent: import('@/types/detail-page').ReviewsContent = {
      ...revContent,
      items: [{ rating: 10, text: '좋아요' }],
    };
    const html = renderSection(makeSection({ type: 'reviews', content: edgeContent }), MOBILE_THEME);
    // 별이 최대 5개
    const stars = html.match(/★/g) ?? [];
    expect(stars.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: reviews describe 블록 FAIL

- [ ] **Step 3: `renderReviews` 스텁을 실제 구현으로 교체**

`section-renderer.ts`의 `renderReviews` 스텁을 아래 구현으로 교체:

```typescript
function renderReviews(content: ReviewsContent, section: DetailSection, colors: PaletteColors): string {
  const cardsHtml = content.items.map((item, i) => {
    const clampedRating = Math.min(5, Math.max(1, Math.round(item.rating)));
    const stars = '★'.repeat(clampedRating);
    const mb = i < content.items.length - 1 ? 'margin-bottom:12px;' : '';
    return `<div style="background-color:${colors.cardBg};border-top:4px solid ${colors.accent};border-radius:8px;padding:16px;${mb}">
  <div style="font-size:16px;color:#FFB800;margin-bottom:8px;">${stars}</div>
  <p style="margin:0;font-size:15px;color:${colors.text};line-height:1.6;">${editableText(`content.items.${i}.text`, item.text)}</p>
</div>`;
  }).join('\n');

  const eyebrowHtml = content.eyebrow
    ? `<div style="font-size:12px;color:${colors.accent};font-weight:700;letter-spacing:0.5px;margin-bottom:6px;">${editableText('content.eyebrow', content.eyebrow)}</div>`
    : '';

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:32px 20px;box-sizing:border-box;">
  ${eyebrowHtml}
  <h2 style="font-size:22px;font-weight:900;color:${colors.text};margin:0 0 20px;line-height:1.35;">${editableText('content.title', content.title)}</h2>
  ${cardsHtml}
</div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
git commit -m "feat(renderer): renderReviews 신규 — 임팩트 타이틀 + 별점 카드"
```

---

## Task 6: AI 프롬프트 스키마 + parseMobileDetailPageResponse (TDD)

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`
- Modify: `src/__tests__/lib/detail-page-prompts.test.ts`

- [ ] **Step 1: `MobileDetailPageContent` 인터페이스 확장**

`detail-page.ts`의 `MobileDetailPageContent` 인터페이스에 두 필드 추가:

```typescript
export interface MobileDetailPageContent {
  brandName: string;
  categoryLabelEn: string;
  hook: {
    eyebrow: string;
    headline: string;
    hashtags: string[];
  };
  points: Array<{
    pointLabel: string;
    headline: string;
    subheadline: string;
  }>;
  colorOptions: Array<{ label: string; swatchColor: string }>;
  comparison: {                          // ← 신규
    painPoint: string;
    counterClaim: string;
    items: Array<{ label: string; theirValue: string; ourValue: string }>;
  } | null;
  reviews: {                             // ← 신규
    title: string;
    eyebrow: string;
    items: Array<{ rating: number; text: string }>;
  };
  specs: Array<{ label: string; value: string }>;
  warnings: string[];
  ctaText: string;
}
```

- [ ] **Step 2: `MOBILE_DETAIL_PAGE_SYSTEM_PROMPT` JSON 스키마 변경**

`MOBILE_DETAIL_PAGE_SYSTEM_PROMPT`에서 `"brandName"` 라인을 찾아 아래처럼 변경:

```
"brandName": "string (상품명에서 브랜드 단어 추출. 불명확하면 상품명 첫 단어 사용. 절대 빈 문자열 금지)",
```

`"warnings"` 라인 바로 앞에 `comparison`과 `reviews` 블록 삽입:

```
  "comparison": {
    "painPoint": "string (기존 제품의 불편함을 질문형으로, 20자 이내. 예: '기존 제품은 소음이 심한데 불편하지 않으셨나요?')",
    "counterClaim": "string (이 제품이 해결함을 단호하게 선언, 20자 이내. 예: '이 제품은 그럴 일 없습니다 ✓')",
    "items": [
      { "label": "string (비교 항목, 5자 이내)", "theirValue": "string (기존 제품, 5자 이내)", "ourValue": "string (이 제품, 5자 이내)" }
    ]
  } | null,
  "reviews": {
    "title": "string (예: '고객님들의 100% 리얼 후기', 20자 이내)",
    "eyebrow": "string (제품+상황 한 줄, 15자 이내. 예: '피치 필통, 연말 선물로도!')",
    "items": [
      { "rating": 5, "text": "string (구어체 리얼 후기 어조, 40자 이내)" }
    ]
  },
```

`## 수량 제약` 섹션 하단에 추가:

```
- comparison.items: null이 아닐 때 2개 이상 4개 이하
- reviews.items: 정확히 2개
```

- [ ] **Step 3: `SECTION_TYPE_HINTS`에 두 타입 힌트 추가**

`SECTION_TYPE_HINTS` 객체에 추가:

```typescript
const SECTION_TYPE_HINTS: Partial<Record<string, string>> = {
  brand_header: 'brandName(브랜드명)과 rightLabel(영문 카테고리)을 가진 상단 헤더',
  point: "pointLabel('Point 1' 또는 빈 문자열), headline(작은따옴표 강조 가능), subheadline(구체적 사실 1문장)을 가진 쿠팡 스타일 포인트 섹션",
  image_grid: 'title과 items[{label, swatchColor}](색상 옵션 라벨)를 가진 2컬럼 이미지 그리드',
  comparison: 'painPoint(기존 제품 불편함 질문), counterClaim(반박 선언), items[{label, theirValue, ourValue}](비교 항목)를 가진 경쟁 비교 섹션',  // ← 추가
  reviews: 'title(섹션 제목), eyebrow(제품+상황 한 줄), items[{rating, text}](후기 카드)를 가진 구매 후기 섹션',  // ← 추가
};
```

- [ ] **Step 4: 실패 테스트 작성**

`detail-page-prompts.test.ts`의 `makeMobileJson` 함수를 찾아 `comparison`과 `reviews` 필드 추가:

```typescript
function makeMobileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    brandName: '킵틸',
    categoryLabelEn: 'pencil pouch',
    hook: { eyebrow: 'Keep Till', headline: '완전 오픈 · 넉넉한 수납', hashtags: ['#한눈에 보여', '#쉽게 꺼내', '#깔끔하게 정리'] },
    points: [
      { pointLabel: 'Point 1', headline: '펼치면 보이는 필통', subheadline: '180도 완전 오픈형' },
      { pointLabel: 'Point 2', headline: '박스처럼 서는 설계', subheadline: '책상 위 안정적' },
      { pointLabel: '', headline: '넉넉하게', subheadline: '20cm 자도 들어가요' },
    ],
    colorOptions: [{ label: '레드', swatchColor: '#D9442C' }],
    comparison: {
      painPoint: '기존 제품은 소음이 심한데 불편하지 않으셨나요?',
      counterClaim: '이 제품은 그럴 일 없습니다 ✓',
      items: [
        { label: '소음', theirValue: '있음', ourValue: '없음' },
        { label: '향', theirValue: '강함', ourValue: '무향' },
      ],
    },
    reviews: {
      title: '고객님들의 100% 리얼 후기',
      eyebrow: '피치 필통, 연말에요~',
      items: [
        { rating: 5, text: '촉촉하게 발리고 향도 없어서 너무 좋아요!' },
        { rating: 5, text: '소음도 없고 사용감이 정말 편해요.' },
      ],
    },
    specs: [{ label: '소재', value: '옥스퍼드' }, { label: '사이즈', value: '20cm' }],
    warnings: ['세탁기 금지', '직사광선 금지'],
    ctaText: '지금 구매하기',
    ...overrides,
  });
}
```

그리고 `describe('parseMobileDetailPageResponse', ...)` 블록 안에 새 테스트 추가:

```typescript
it('comparison 필드를 파싱한다', () => {
  const content = parseMobileDetailPageResponse(makeMobileJson());
  expect(content.comparison).not.toBeNull();
  expect(content.comparison!.painPoint).toBe('기존 제품은 소음이 심한데 불편하지 않으셨나요?');
  expect(content.comparison!.counterClaim).toBe('이 제품은 그럴 일 없습니다 ✓');
  expect(content.comparison!.items).toHaveLength(2);
  expect(content.comparison!.items[0]).toEqual({ label: '소음', theirValue: '있음', ourValue: '없음' });
});

it('comparison이 null이면 null로 파싱한다', () => {
  const content = parseMobileDetailPageResponse(makeMobileJson({ comparison: null }));
  expect(content.comparison).toBeNull();
});

it('comparison이 누락되면 null로 폴백한다', () => {
  const content = parseMobileDetailPageResponse(makeMobileJson({ comparison: undefined }));
  expect(content.comparison).toBeNull();
});

it('reviews 필드를 파싱한다', () => {
  const content = parseMobileDetailPageResponse(makeMobileJson());
  expect(content.reviews.title).toBe('고객님들의 100% 리얼 후기');
  expect(content.reviews.eyebrow).toBe('피치 필통, 연말에요~');
  expect(content.reviews.items).toHaveLength(2);
  expect(content.reviews.items[0].rating).toBe(5);
  expect(content.reviews.items[0].text).toContain('촉촉하게');
});

it('reviews가 누락되면 빈 기본값으로 폴백한다', () => {
  const content = parseMobileDetailPageResponse(makeMobileJson({ reviews: undefined }));
  expect(content.reviews.title).toBe('');
  expect(content.reviews.items).toEqual([]);
});
```

- [ ] **Step 5: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 새 테스트들 FAIL (파서가 아직 comparison·reviews를 처리하지 않음)

- [ ] **Step 6: `parseMobileDetailPageResponse` 업데이트**

`parseMobileDetailPageResponse` 함수에서 `return {` 블록 직전에 comparison·reviews 파싱 로직 삽입:

```typescript
// comparison 파싱 (null-safe)
const compRaw = data.comparison as Record<string, unknown> | null | undefined;
let comparison: MobileDetailPageContent['comparison'] = null;
if (compRaw != null && typeof compRaw === 'object') {
  const compItems = Array.isArray(compRaw.items)
    ? (compRaw.items as Array<Record<string, unknown> | null>)
        .filter((it): it is Record<string, unknown> => it != null)
        .map(it => ({ label: str(it.label), theirValue: str(it.theirValue), ourValue: str(it.ourValue) }))
        .filter(it => it.label.length > 0)
    : [];
  if (compItems.length > 0) {
    comparison = {
      painPoint: str(compRaw.painPoint),
      counterClaim: str(compRaw.counterClaim),
      items: compItems,
    };
  }
}

// reviews 파싱 (missing → 빈 기본값)
const revRaw = data.reviews as Record<string, unknown> | undefined;
const reviews: MobileDetailPageContent['reviews'] = {
  title: str(revRaw?.title),
  eyebrow: str(revRaw?.eyebrow),
  items: Array.isArray(revRaw?.items)
    ? (revRaw!.items as Array<Record<string, unknown> | null>)
        .filter((it): it is Record<string, unknown> => it != null)
        .map(it => ({
          rating: typeof it.rating === 'number' ? Math.min(5, Math.max(1, Math.round(it.rating))) : 5,
          text: str(it.text),
        }))
        .filter(it => it.text.length > 0)
    : [],
};
```

그리고 `return {` 블록에 두 필드 추가:

```typescript
return {
  brandName: str(data.brandName),
  categoryLabelEn: str(data.categoryLabelEn),
  hook: {
    eyebrow: str(hook.eyebrow),
    headline: hook.headline.trim(),
    hashtags: strArr(hook.hashtags).slice(0, 3),
  },
  points: (data.points as Array<Record<string, unknown> | null>).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      pointLabel: str(o.pointLabel),
      headline: str(o.headline),
      subheadline: str(o.subheadline),
    };
  }),
  colorOptions: Array.isArray(data.colorOptions)
    ? (data.colorOptions as Array<Record<string, unknown> | null>)
        .filter((c): c is Record<string, unknown> => c != null && typeof c.label === 'string' && c.label.length > 0)
        .map((c) => ({ label: c.label as string, swatchColor: str(c.swatchColor) }))
    : [],
  comparison,   // ← 추가
  reviews,      // ← 추가
  specs: Array.isArray(data.specs)
    ? (data.specs as Array<Record<string, unknown> | null>)
        .filter((s): s is Record<string, unknown> => s != null && typeof s.label === 'string' && typeof s.value === 'string')
        .map((s) => ({ label: s.label as string, value: s.value as string }))
    : [],
  warnings: strArr(data.warnings),
  ctaText: str(data.ctaText).trim() || '지금 구매하기',
};
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 전체 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/lib/ai/prompts/detail-page.ts src/__tests__/lib/detail-page-prompts.test.ts
git commit -m "feat(prompts): MobileDetailPageContent comparison·reviews 필드 + 파서 업데이트"
```

---

## Task 7: brandName 폴백 (API 라우트)

**Files:**
- Modify: `src/app/api/ai/generate-detail-html/route.ts`

- [ ] **Step 1: 파싱 직후 brandName 폴백 추가**

`route.ts`에서 `mobileContent = parseMobileDetailPageResponse(rawMobileText);` 라인 바로 다음에 삽입:

```typescript
// brandName이 비어 있으면 productName 첫 단어로 폴백 (AI가 빈 문자열 반환 시 brand_header 생략 방지)
if (!mobileContent.brandName.trim()) {
  const fallback = (productName ?? '').trim().split(/\s+/)[0] || 'Brand';
  mobileContent = { ...mobileContent, brandName: fallback };
}
```

- [ ] **Step 2: 빌드 오류 없음 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/ai/generate-detail-html/route.ts
git commit -m "fix(api): brandName 빈 문자열 시 productName 첫 단어로 폴백 — brand_header 항상 생성"
```

---

## Task 8: mobileContentToSections 업데이트 + createEmptySection (TDD)

**Files:**
- Modify: `src/lib/detail-page/section-parser.ts`
- Modify: `src/__tests__/lib/detail-page/mobile-section-parser.test.ts`

- [ ] **Step 1: `makeContent` 헬퍼 업데이트**

`mobile-section-parser.test.ts`의 `makeContent` 함수에 comparison·reviews 필드 추가:

```typescript
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
    comparison: null,                    // ← 추가 (기본 null)
    reviews: {                           // ← 추가
      title: '고객님들의 100% 리얼 후기',
      eyebrow: '피치 필통, 연말에요~',
      items: [
        { rating: 5, text: '촉촉하게 발리고 향도 없어서 너무 좋아요!' },
        { rating: 5, text: '소음도 없고 사용감이 정말 편해요.' },
      ],
    },
    specs: [
      { label: '사이즈', value: '20 x 9.5 x 9.5 (cm)' },
      { label: '소재', value: '옥스퍼드 생활방수직물' },
    ],
    warnings: ['세탁기 사용 금지', '직사광선 보관 금지'],
    ctaText: '지금 구매하기',
    ...overrides,
  };
}
```

- [ ] **Step 2: 기존 순서 테스트 업데이트 + 신규 테스트 추가**

기존 순서 테스트를 찾아 기대값 업데이트 (reviews 섹션이 image_grid 뒤에 추가됨):

```typescript
it('brand_header → hero → point×N → image_grid → reviews → spec_table → warning → cta 순서로 생성한다', () => {
  const sections = mobileContentToSections(makeContent(), URLS);
  expect(sections.map((s) => s.type)).toEqual([
    'brand_header', 'hero', 'point', 'point', 'point', 'image_grid', 'reviews', 'spec_table', 'warning', 'cta',
  ]);
});
```

신규 테스트 추가 (기존 describe 블록 안에):

```typescript
it('comparison이 있으면 image_grid 앞에 comparison 섹션이 추가된다', () => {
  const content = makeContent({
    comparison: {
      painPoint: '소음 있죠?',
      counterClaim: '없습니다 ✓',
      items: [{ label: '소음', theirValue: '있음', ourValue: '없음' }],
    },
  });
  const sections = mobileContentToSections(content, URLS);
  expect(sections.map((s) => s.type)).toEqual([
    'brand_header', 'hero', 'point', 'point', 'point', 'comparison', 'image_grid', 'reviews', 'spec_table', 'warning', 'cta',
  ]);
});

it('comparison이 있으면 leftover 첫 2장이 comparison에 배정되고 나머지는 image_grid로 간다', () => {
  // points 3개 → img[1..3] 소비, leftover = img[4], img[5]
  // comparison이 있으면 leftover[0..1] = comparison, leftover[2..] = image_grid
  const content = makeContent({
    colorOptions: [], // image_grid 조건 단순화
    comparison: {
      painPoint: '소음 있죠?',
      counterClaim: '없습니다 ✓',
      items: [{ label: '소음', theirValue: '있음', ourValue: '없음' }],
    },
  });
  // URLS[0]=hero, [1..3]=point, [4],[5]=leftover
  const sections = mobileContentToSections(content, URLS);
  const compSection = sections.find((s) => s.type === 'comparison')!;
  expect(compSection.attachedImages.map((i) => i.url)).toEqual([
    'https://example.com/4.jpg',
    'https://example.com/5.jpg',
  ]);
  // leftover가 2장이고 comparison이 다 소비했으므로 image_grid 없음
  expect(sections.find((s) => s.type === 'image_grid')).toBeUndefined();
});

it('reviews.items가 비어 있으면 reviews 섹션을 생략한다', () => {
  const content = makeContent({ reviews: { title: '', eyebrow: '', items: [] } });
  const sections = mobileContentToSections(content, URLS);
  expect(sections.find((s) => s.type === 'reviews')).toBeUndefined();
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-parser.test.ts
```

Expected: 순서 테스트 + 신규 테스트 FAIL

- [ ] **Step 4: `mobileContentToSections` 업데이트**

`section-parser.ts`의 `mobileContentToSections` 함수에서 `// 남는 이미지 분배` 주석부터 끝까지를 아래로 교체:

```typescript
  // 남는 이미지 분배
  const leftover = imageUrls.slice(1 + content.points.length);
  const hasComparison = content.comparison != null;

  // comparison이 있으면 leftover 첫 2장 배정, 나머지는 image_grid로
  const compImages = hasComparison ? leftover.slice(0, 2) : [];
  const gridLeftover = hasComparison ? leftover.slice(2) : leftover;

  // comparison 섹션
  if (hasComparison && content.comparison) {
    sections.push({
      id: uuidv4(),
      type: 'comparison',
      order: order++,
      content: {
        type: 'comparison',
        painPoint: content.comparison.painPoint,
        counterClaim: content.comparison.counterClaim,
        items: content.comparison.items,
      },
      attachedImages: compImages.map((u, i) => toAttached(u, i)),
      ...base,
    });
  }

  // image_grid (남는 이미지)
  const hasColorOptions = content.colorOptions.length > 0;
  if (hasColorOptions) {
    const items: Array<{ label: string; swatchColor?: string }> = [...content.colorOptions];
    while (items.length < gridLeftover.length) items.push({ label: '' });
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items },
      attachedImages: gridLeftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (gridLeftover.length >= 2) {
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items: gridLeftover.map(() => ({ label: '' })) },
      attachedImages: gridLeftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (gridLeftover.length === 1 && pointSections.length > 0) {
    const last = pointSections[pointSections.length - 1];
    last.attachedImages = [...last.attachedImages, toAttached(gridLeftover[0], last.attachedImages.length)];
  }

  // reviews (items가 있을 때만)
  if (content.reviews.items.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'reviews',
      order: order++,
      content: {
        type: 'reviews',
        title: content.reviews.title,
        eyebrow: content.reviews.eyebrow,
        items: content.reviews.items,
      },
      attachedImages: [],
      ...base,
    });
  }

  // spec_table / warning / cta
  if (content.specs.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'spec_table',
      order: order++,
      content: { type: 'spec_table', specs: content.specs },
      attachedImages: [],
      ...base,
    });
  }
  if (content.warnings.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'warning',
      order: order++,
      content: { type: 'warning', warnings: content.warnings },
      attachedImages: [],
      ...base,
    });
  }
  sections.push({
    id: uuidv4(),
    type: 'cta',
    order: order++,
    content: { type: 'cta', text: content.ctaText },
    attachedImages: [],
    ...base,
  });

  return sections;
```

- [ ] **Step 5: `createEmptySection`에 케이스 추가**

`createEmptySection` 함수의 switch 문에 추가:

```typescript
case 'comparison':
  return {
    ...base,
    type: 'comparison',
    content: { type: 'comparison', painPoint: '', counterClaim: '', items: [] },
  };
case 'reviews':
  return {
    ...base,
    type: 'reviews',
    content: { type: 'reviews', title: '', eyebrow: '', items: [] },
  };
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/mobile-section-parser.test.ts
```

Expected: 전체 PASS

- [ ] **Step 7: 전체 테스트 회귀 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts src/__tests__/lib/detail-page/mobile-section-parser.test.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
```

Expected: 전체 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/lib/detail-page/section-parser.ts src/__tests__/lib/detail-page/mobile-section-parser.test.ts
git commit -m "feat(parser): mobileContentToSections — comparison·reviews 섹션 추가, 이미지 배분 수정"
```

---

## 최종 검증

- [ ] **TypeScript 전체 빌드 오류 없음**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **전체 관련 테스트 통과**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts src/__tests__/lib/detail-page/mobile-section-parser.test.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts src/__tests__/lib/detail-page/section-parser.test.ts
```

Expected: 전체 PASS
