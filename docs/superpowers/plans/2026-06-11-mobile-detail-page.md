# 상품상세 자동만들기 — 쿠팡 모바일 스타일 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/listing/detail-maker`가 쿠팡 모바일 상세페이지 구조(브랜드 헤더 → 후킹 히어로 → Point N 섹션 → 옵션 그리드 → 스펙 테이블)의 결과물을 생성하도록 섹션 타입 체계를 확장한다.

**Architecture:** 신규 섹션 타입 3종(`brand_header`, `point`, `image_grid`)과 `DetailPageTheme.layoutMode`('desktop'|'mobile')를 추가해 기존 섹션 에디터·렌더 API 경로를 그대로 통과시킨다. AI는 새 `MobileDetailPageContent` 스키마로 카피를 생성하고, `mobileContentToSections()`가 이미지 배치 규칙에 따라 섹션 배열로 변환한다. 기존 데스크톱 흐름은 `layoutMode` 기본값 `'desktop'`으로 무영향.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Claude API(claude-sonnet-4-6), Vitest

**스펙 문서:** `docs/superpowers/specs/2026-06-11-mobile-detail-page-design.md`

**중요 발견 (구현 시 필수 반영):**
- `src/app/api/detail-page/render/route.ts:32`의 Zod `type` enum이 기존 8종으로 잠겨 있다 — 신규 타입 미추가 시 렌더 API가 400 반환.
- 같은 파일 `theme` Zod 스키마에 `layoutMode`가 없다 — Zod `z.object`는 미정의 키를 **조용히 제거**하므로 미추가 시 모바일 렌더링이 소리 없이 데스크톱으로 떨어진다.
- 같은 파일 `attachedImages`가 `.max(2)` — `image_grid`는 최대 6장 필요하므로 `.max(6)`으로 상향.
- `SectionCard.tsx:36` `SECTION_TYPE_LABELS`와 `section-renderer.ts:44` `SECTION_LABELS`는 `Record<SectionType, string>` (exhaustive) — 타입 추가 즉시 typecheck가 깨지므로 Task 1에서 한꺼번에 보강한다.

---

### Task 1: 신규 섹션 타입 정의 + 시스템 전체 기계적 등록

타입 유니온 확장과, 그로 인해 typecheck가 깨지는 모든 exhaustive 지점을 한 커밋으로 보강한다. 렌더러는 빈 스텁으로 두고 Task 2에서 TDD로 구현한다.

**Files:**
- Modify: `src/types/detail-page.ts`
- Modify: `src/lib/detail-page/section-renderer.ts` (라벨 + 스텁 케이스만)
- Modify: `src/lib/detail-page/section-parser.ts` (`createEmptySection`만)
- Modify: `src/components/listing/detail-editor/SectionCard.tsx` (라벨 + 요약)
- Modify: `src/components/listing/detail-editor/DetailPageEditor.tsx` (`ADD_SECTION_OPTIONS`)
- Modify: `src/app/api/detail-page/render/route.ts` (Zod 스키마)
- Test: `src/__tests__/lib/detail-page/section-parser.test.ts` (기존 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 작성 — 타입 가드 + createEmptySection 신규 타입**

`src/__tests__/lib/detail-page/section-parser.test.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-parser.test.ts`
Expected: FAIL — `'brand_header'` 타입이 `SectionType`에 없어 TS 에러 또는 switch 미해당으로 undefined 반환

- [ ] **Step 3: `src/types/detail-page.ts` 타입 추가**

`SectionType` 유니온 확장:

```ts
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
  | 'image_grid';
```

`CtaContent` 아래에 신규 콘텐츠 3종 추가:

```ts
export interface BrandHeaderContent {
  type: 'brand_header';
  brandName: string;     // 좌측 브랜드명 (예: "킵틸 KeepTill")
  rightLabel: string;    // 우측 영문 카테고리 (예: "pencil pouch")
}

export interface PointContent {
  type: 'point';
  pointLabel: string;    // "Point 1" — 빈 문자열이면 라벨 줄 숨김
  headline: string;      // 예: "펼치면 바로 '보이는' 필통"
  subheadline: string;   // 예: "180도 완전 오픈형 구조"
}

export interface ImageGridContent {
  type: 'image_grid';
  title: string;                                          // "Product Info." (빈 값이면 생략)
  items: Array<{ label: string; swatchColor?: string }>;  // 이미지는 attachedImages와 index 매칭
}
```

`SectionContent` 유니온에 3종 추가:

```ts
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
  | ImageGridContent;
```

`DetailPageTheme`에 layoutMode 추가:

```ts
export interface DetailPageTheme {
  palette: PaletteName;
  primaryColor: string;
  accentColor: string;
  fontStyle: FontStyle;
  imageLayout: ImageLayout;
  /** 렌더링 레이아웃 모드 — 미지정 시 'desktop' (기존 흐름 무영향) */
  layoutMode?: 'desktop' | 'mobile';
}
```

파일 끝 타입 가드 3종 추가:

```ts
export function isBrandHeaderContent(c: SectionContent): c is BrandHeaderContent {
  return c.type === 'brand_header';
}
export function isPointContent(c: SectionContent): c is PointContent {
  return c.type === 'point';
}
export function isImageGridContent(c: SectionContent): c is ImageGridContent {
  return c.type === 'image_grid';
}
```

- [ ] **Step 4: `section-parser.ts` — `createEmptySection` switch에 3종 케이스 추가**

```ts
    case 'brand_header':
      return { ...base, type: 'brand_header', content: { type: 'brand_header', brandName: '', rightLabel: '' } };
    case 'point':
      return { ...base, type: 'point', content: { type: 'point', pointLabel: '', headline: '', subheadline: '' } };
    case 'image_grid':
      return { ...base, type: 'image_grid', content: { type: 'image_grid', title: '', items: [] } };
```

- [ ] **Step 5: `section-renderer.ts` — 라벨 + 스텁 케이스 추가**

`SECTION_LABELS`(44행)에 추가:

```ts
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
```

`renderSection` switch(267행~) 끝에 스텁 추가 (Task 2에서 실제 구현으로 교체):

```ts
    case 'brand_header':
      return '';
    case 'point':
      return '';
    case 'image_grid':
      return '';
```

- [ ] **Step 6: `SectionCard.tsx` — 라벨 + 요약 추가**

`SECTION_TYPE_LABELS`(36행)에 추가:

```ts
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
```

`getSectionSummary`의 `return '';` 직전에 추가 (상단 import에 `isBrandHeaderContent, isPointContent, isImageGridContent` 추가):

```ts
  if (isBrandHeaderContent(content)) {
    return content.brandName || '(브랜드 없음)';
  }
  if (isPointContent(content)) {
    return content.headline || '(제목 없음)';
  }
  if (isImageGridContent(content)) {
    return `${content.items.length}개 이미지`;
  }
```

- [ ] **Step 7: `DetailPageEditor.tsx` — `ADD_SECTION_OPTIONS`(147행)에 3종 추가**

```ts
  { type: 'brand_header', label: '브랜드 헤더' },
  { type: 'point', label: '포인트' },
  { type: 'image_grid', label: '이미지 그리드' },
```

- [ ] **Step 8: `render/route.ts` Zod 스키마 갱신 (32행, 43행, 50행)**

```ts
        type: z.enum(['hero', 'selling_points', 'features', 'stats', 'spec_table', 'usage_steps', 'warning', 'cta', 'brand_header', 'point', 'image_grid']),
```

`attachedImages`의 `.max(2)` → `.max(6)` (image_grid 최대 6장).

`theme` 스키마에 추가 (미추가 시 Zod가 layoutMode를 조용히 제거함):

```ts
    layoutMode: z.enum(['desktop', 'mobile']).optional(),
```

- [ ] **Step 9: 테스트 + typecheck 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-parser.test.ts && npx tsc --noEmit`
Expected: PASS / 에러 없음

- [ ] **Step 10: Commit**

```bash
git add src/types/detail-page.ts src/lib/detail-page/section-renderer.ts src/lib/detail-page/section-parser.ts src/components/listing/detail-editor/SectionCard.tsx src/components/listing/detail-editor/DetailPageEditor.tsx src/app/api/detail-page/render/route.ts src/__tests__/lib/detail-page/section-parser.test.ts
git commit -m "feat: 모바일 섹션 타입 3종(brand_header/point/image_grid) + layoutMode 정의"
```

---

### Task 2: 신규 섹션 렌더러 3종 구현 (TDD)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Test: `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/mobile-section-renderer.test.ts` 신규 생성:

```ts
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const MOBILE_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
  layoutMode: 'mobile',
};

function makeSection(partial: Partial<DetailSection> & Pick<DetailSection, 'type' | 'content'>): DetailSection {
  return { id: 'test-id', order: 0, attachedImages: [], ...partial };
}

describe('renderSection — brand_header', () => {
  it('브랜드명과 우측 라벨을 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'brand_header', content: { type: 'brand_header', brandName: '킵틸 KeepTill', rightLabel: 'pencil pouch' } }),
      MOBILE_THEME,
    );
    expect(html).toContain('킵틸 KeepTill');
    expect(html).toContain('pencil pouch');
    expect(html).toContain('data-section-type="brand_header"');
  });

  it('HTML 특수문자를 이스케이프한다', () => {
    const html = renderSection(
      makeSection({ type: 'brand_header', content: { type: 'brand_header', brandName: '<script>x</script>', rightLabel: '' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSection — point', () => {
  const content = { type: 'point' as const, pointLabel: 'Point 1', headline: "펼치면 바로 '보이는' 필통", subheadline: '180도 완전 오픈형 구조' };

  it('라벨·헤드라인·서브헤드라인을 렌더링한다', () => {
    const html = renderSection(makeSection({ type: 'point', content }), MOBILE_THEME);
    expect(html).toContain('Point 1');
    expect(html).toContain('보이는');
    expect(html).toContain('180도 완전 오픈형 구조');
  });

  it('pointLabel이 빈 문자열이면 라벨 줄을 렌더링하지 않는다', () => {
    const html = renderSection(
      makeSection({ type: 'point', content: { ...content, pointLabel: '' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('font-style:italic');
  });

  it('attachedImages를 전체폭(width:100%)으로 렌더링한다', () => {
    const html = renderSection(
      makeSection({
        type: 'point',
        content,
        attachedImages: [{ url: 'https://example.com/a.jpg', order: 0, processingMode: 'original' }],
      }),
      MOBILE_THEME,
    );
    expect(html).toContain('https://example.com/a.jpg');
    expect(html).toContain('width:100%');
  });

  it('http(s)가 아닌 이미지 URL은 렌더링하지 않는다', () => {
    const html = renderSection(
      makeSection({
        type: 'point',
        content,
        attachedImages: [{ url: 'javascript:alert(1)', order: 0, processingMode: 'original' }],
      }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('javascript:');
  });
});

describe('renderSection — image_grid', () => {
  const content = {
    type: 'image_grid' as const,
    title: 'Product Info.',
    items: [
      { label: '레드', swatchColor: '#D9442C' },
      { label: '하늘', swatchColor: '#AEDCF0' },
    ],
  };

  it('타이틀·라벨·스와치를 렌더링한다', () => {
    const html = renderSection(
      makeSection({
        type: 'image_grid',
        content,
        attachedImages: [
          { url: 'https://example.com/red.jpg', order: 0, processingMode: 'original' },
          { url: 'https://example.com/sky.jpg', order: 1, processingMode: 'original' },
        ],
      }),
      MOBILE_THEME,
    );
    expect(html).toContain('Product Info.');
    expect(html).toContain('레드');
    expect(html).toContain('#D9442C');
    expect(html).toContain('https://example.com/red.jpg');
    expect(html).toContain('width:50%');
  });

  it('title이 빈 문자열이면 타이틀을 렌더링하지 않는다', () => {
    const html = renderSection(makeSection({ type: 'image_grid', content: { ...content, title: '' } }), MOBILE_THEME);
    expect(html).not.toContain('<h2');
  });

  it('유효하지 않은 swatchColor는 기본 회색으로 대체한다', () => {
    const html = renderSection(
      makeSection({
        type: 'image_grid',
        content: { type: 'image_grid', title: '', items: [{ label: 'X', swatchColor: 'red;background:url(x)' }] },
      }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('url(x)');
    expect(html).toContain('#cccccc');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`
Expected: FAIL — 스텁이 `''`를 반환하므로 모든 expect 실패

- [ ] **Step 3: 렌더러 구현**

`section-renderer.ts` import에 `BrandHeaderContent, PointContent, ImageGridContent` 추가. `renderCta` 아래에 구현 추가:

```ts
// ─────────────────────────────────────────
// 모바일 섹션 렌더러 (brand_header / point / image_grid)
// ─────────────────────────────────────────

/** attachedImages 전체를 전체폭 이미지로 렌더링 (패딩 0) */
function renderFullBleedImages(section: DetailSection): string {
  return section.attachedImages
    .map((img) => {
      const safe = sanitizeUrl(img.url);
      return safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;" />` : '';
    })
    .join('');
}

/** #RGB/#RRGGBB/#RRGGBBAA hex만 허용, 그 외 기본 회색 (CSS 인젝션 방지) */
function sanitizeSwatchColor(color: string | undefined): string {
  return color && /^#[0-9A-Fa-f]{3,8}$/.test(color) ? color : '#cccccc';
}

function renderBrandHeader(content: BrandHeaderContent, section: DetailSection): string {
  return `<div ${sectionAttrs(section)} style="display:flex;justify-content:space-between;align-items:baseline;padding:16px 20px;border-bottom:1px solid #ddd;background-color:#fff;box-sizing:border-box;">
  <span style="font-size:15px;font-weight:600;color:#333;">${editableText('content.brandName', content.brandName)}</span>
  <span style="font-size:13px;color:#999;">${editableText('content.rightLabel', content.rightLabel)}</span>
</div>`;
}

function renderPoint(content: PointContent, section: DetailSection, colors: PaletteColors): string {
  const labelHtml = content.pointLabel
    ? `<div style="margin-bottom:12px;"><span style="display:block;font-size:18px;color:#999;margin-bottom:6px;">&#9745;</span><span style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:#999;">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
    : '';
  return `<div ${sectionAttrs(section)} style="background-color:#fff;padding:0;box-sizing:border-box;">
  <div style="padding:40px 20px 28px;text-align:center;">
    ${labelHtml}
    <h2 style="margin:0 0 10px;font-size:28px;font-weight:800;color:#111;line-height:1.35;letter-spacing:-0.5px;">${editableText('content.headline', content.headline)}</h2>
    <p style="margin:0;font-size:17px;color:#555;line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
  </div>
  ${renderFullBleedImages(section)}
</div>`;
}

function renderImageGrid(content: ImageGridContent, section: DetailSection): string {
  const titleHtml = content.title
    ? `<h2 style="margin:0 0 24px;font-family:Georgia,serif;font-size:26px;font-weight:400;color:#5c4f42;text-align:center;">${editableText('content.title', content.title)}</h2>`
    : '';
  const cells = content.items
    .map((item, i) => {
      const img = section.attachedImages[i];
      const safe = img ? sanitizeUrl(img.url) : '';
      const imgHtml = safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;border-radius:8px;" />` : '';
      const swatchHtml = item.swatchColor !== undefined
        ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background-color:${sanitizeSwatchColor(item.swatchColor)};margin-right:6px;vertical-align:-2px;"></span>`
        : '';
      const labelHtml = item.label
        ? `<div style="margin-top:8px;font-size:15px;color:#333;">${swatchHtml}${editableText(`content.items.${i}.label`, item.label)}</div>`
        : '';
      return `<div style="width:50%;padding:8px;box-sizing:border-box;text-align:center;">${imgHtml}${labelHtml}</div>`;
    })
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:#fff;padding:40px 12px;box-sizing:border-box;">
  ${titleHtml}
  <div style="display:flex;flex-wrap:wrap;">${cells}</div>
</div>`;
}
```

`renderSection` switch의 스텁 3종을 실제 호출로 교체:

```ts
    case 'brand_header':
      return renderBrandHeader(section.content as BrandHeaderContent, section);
    case 'point':
      return renderPoint(section.content as PointContent, section, colors);
    case 'image_grid':
      return renderImageGrid(section.content as ImageGridContent, section);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
git commit -m "feat: brand_header/point/image_grid 섹션 렌더러 구현"
```

---

### Task 3: 기존 섹션의 mobile layoutMode 분기 (TDD)

hero/spec_table은 모바일 전용 변형으로, warning/cta는 패딩·폰트 축소로 분기한다. desktop 회귀 없음을 테스트로 보증한다.

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Test: `src/__tests__/lib/detail-page/mobile-section-renderer.test.ts` (추가)

- [ ] **Step 1: 실패하는 테스트 작성** — 같은 테스트 파일에 추가:

```ts
const DESKTOP_THEME: DetailPageTheme = { ...MOBILE_THEME, layoutMode: undefined };

describe('renderSection — mobile layoutMode 분기', () => {
  const heroSection = makeSection({
    type: 'hero',
    content: { type: 'hero', headline: '완전 오픈 · 넉넉한 수납', subheadline: '#한눈에 보여  #쉽게 꺼내  #깔끔하게 정리' },
    eyebrow: 'Keep Till',
  });

  it('mobile hero: 34px 헤드라인 + 필기체 eyebrow를 렌더링한다', () => {
    const html = renderSection(heroSection, MOBILE_THEME);
    expect(html).toContain('font-size:34px');
    expect(html).toContain('Keep Till');
    expect(html).toContain('cursive');
  });

  it('mobile hero: #으로 시작하는 subheadline은 해시태그 행으로 렌더링한다', () => {
    const html = renderSection(heroSection, MOBILE_THEME);
    expect(html).toContain('word-spacing');
    expect(html).toContain('#한눈에 보여');
  });

  it('mobile hero: 일반 subheadline은 문단으로 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'hero', content: { type: 'hero', headline: 'A', subheadline: '일반 설명 문장' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('word-spacing');
  });

  it('desktop hero: layoutMode 미지정 시 기존 60px 40px 패딩을 유지한다 (회귀)', () => {
    const html = renderSection(heroSection, DESKTOP_THEME);
    expect(html).toContain('padding:60px 40px');
    expect(html).not.toContain('font-size:34px');
  });

  it('mobile spec_table: 회색 패널(#f4f5f7) 스타일로 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'spec_table', content: { type: 'spec_table', specs: [{ label: '소재', value: '옥스퍼드' }] } }),
      MOBILE_THEME,
    );
    expect(html).toContain('#f4f5f7');
    expect(html).toContain('소재');
  });

  it('desktop spec_table: 기존 테이블 스타일을 유지한다 (회귀)', () => {
    const html = renderSection(
      makeSection({ type: 'spec_table', content: { type: 'spec_table', specs: [{ label: '소재', value: '옥스퍼드' }] } }),
      DESKTOP_THEME,
    );
    expect(html).not.toContain('#f4f5f7');
    expect(html).toContain('padding:60px 40px');
  });

  it('mobile warning/cta: 패딩이 20px 좌우로 축소된다', () => {
    const warningHtml = renderSection(
      makeSection({ type: 'warning', content: { type: 'warning', warnings: ['주의1'] } }),
      MOBILE_THEME,
    );
    const ctaHtml = renderSection(
      makeSection({ type: 'cta', content: { type: 'cta', text: '지금 구매하기' } }),
      MOBILE_THEME,
    );
    expect(warningHtml).toContain('padding:32px 20px');
    expect(ctaHtml).toContain('padding:40px 20px');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts`
Expected: FAIL — mobile 분기 미구현 (desktop 회귀 테스트 2개만 PASS)

- [ ] **Step 3: mobile 분기 구현**

`renderHero` 함수 첫 줄에 분기 추가:

```ts
function renderHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (theme.layoutMode === 'mobile') return renderMobileHero(content, section, colors);
  // ... 기존 코드 그대로
```

`renderHero` 아래에 신규 함수:

```ts
function renderMobileHero(content: HeroContent, section: DetailSection, colors: PaletteColors): string {
  const eyebrowHtml = section.eyebrow
    ? `<div style="font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:22px;color:#8a7560;margin-bottom:10px;">${escapeHtml(section.eyebrow)}</div>`
    : '';
  const sub = content.subheadline.trim();
  const subHtml = sub.startsWith('#')
    ? `<div style="text-align:center;"><span data-edit-path="content.subheadline" style="font-size:18px;font-weight:700;color:#222;word-spacing:12px;line-height:1.8;">${escapeHtml(sub)}</span></div>`
    : `<p style="margin:0;font-size:17px;color:#555;line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>`;
  return `<div ${sectionAttrs(section)} style="background-color:#fff;padding:0;box-sizing:border-box;">
  <div style="padding:32px 20px 24px;text-align:center;">
    ${eyebrowHtml}
    <h1 style="margin:0 0 14px;font-size:34px;font-weight:800;color:#1a1a1a;letter-spacing:-1px;line-height:1.3;">${editableText('content.headline', content.headline)}</h1>
    ${subHtml}
  </div>
  ${renderFullBleedImages(section)}
</div>`;
}
```

`renderSpecTable` 첫 줄에 분기 추가:

```ts
  if (theme.layoutMode === 'mobile') return renderMobileSpecTable(content, section);
```

신규 함수:

```ts
function renderMobileSpecTable(content: SpecTableContent, section: DetailSection): string {
  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:14px 8px;font-size:15px;font-weight:600;color:#666;width:32%;border-bottom:1px solid #e3e5e8;vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:14px 8px;font-size:15px;color:#222;border-bottom:1px solid #e3e5e8;vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`,
    )
    .join('\n');
  return `<div ${sectionAttrs(section)} style="background-color:#fff;padding:32px 20px;box-sizing:border-box;">
  <div style="background-color:#f4f5f7;border-radius:8px;padding:8px 16px;">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      ${rowsHtml}
    </table>
  </div>
</div>`;
}
```

`renderWarning` 패딩을 조건부로 (기존 `padding:32px 40px` 부분):

```ts
  const pad = theme.layoutMode === 'mobile' ? '32px 20px' : '32px 40px';
  // ... style="...padding:${pad};..."
```

`renderCta` 패딩·폰트를 조건부로 (기존 `padding:60px 40px`, `font-size:36px`):

```ts
  const pad = theme.layoutMode === 'mobile' ? '40px 20px' : '60px 40px';
  const fontSize = theme.layoutMode === 'mobile' ? '24px' : '36px';
```

- [ ] **Step 4: 전체 렌더러 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-renderer.test.ts src/__tests__/lib/detail-page/`
Expected: PASS (기존 렌더러 테스트 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/mobile-section-renderer.test.ts
git commit -m "feat: hero/spec_table/warning/cta 모바일 layoutMode 분기"
```

---

### Task 4: MobileDetailPageContent 타입 + mobileContentToSections (TDD)

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts` (타입만)
- Modify: `src/lib/detail-page/section-parser.ts`
- Test: `src/__tests__/lib/detail-page/mobile-section-parser.test.ts` (신규)

- [ ] **Step 1: `detail-page.ts`의 `DetailPageContent` 아래에 타입 추가**

```ts
export interface MobileDetailPageContent {
  brandName: string;            // 빈 문자열이면 brand_header 섹션 생략
  categoryLabelEn: string;      // 예: "pencil pouch"
  hook: {
    eyebrow: string;            // 예: "Keep Till" — 필기체 렌더링
    headline: string;           // 예: "완전 오픈 · 넉넉한 수납"
    hashtags: string[];         // 예: ["#한눈에 보여", "#쉽게 꺼내", "#깔끔하게 정리"]
  };
  points: Array<{
    pointLabel: string;         // "Point 1" 또는 "" (요약 섹션)
    headline: string;
    subheadline: string;
  }>;
  colorOptions: Array<{ label: string; swatchColor: string }>;
  specs: Array<{ label: string; value: string }>;
  warnings: string[];
  ctaText: string;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/mobile-section-parser.test.ts` 신규 생성:

```ts
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
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-parser.test.ts`
Expected: FAIL — `mobileContentToSections`가 export되지 않음

- [ ] **Step 4: `section-parser.ts`에 구현**

import에 `MobileDetailPageContent`와 `AttachedImage` 추가. `contentToSections` 아래에:

```ts
/**
 * MobileDetailPageContent(모바일 AI 생성 결과)를 DetailSection[]으로 변환한다.
 * 이미지 배치 규칙 (스펙 §6):
 *  - img[0] → hero, img[1..] → 각 point에 1장씩
 *  - 남는 이미지: colorOptions 있으면 전부 image_grid로,
 *    없으면 2장 이상일 때만 라벨 없는 image_grid, 정확히 1장이면 마지막 point에 추가
 */
export function mobileContentToSections(
  content: MobileDetailPageContent,
  imageUrls: string[],
): DetailSection[] {
  if (!content.hook?.headline?.trim()) {
    throw new Error('mobileContentToSections: hook.headline must not be empty');
  }
  if (!content.ctaText?.trim()) {
    throw new Error('mobileContentToSections: ctaText must not be empty');
  }

  const toAttached = (url: string, order: number): AttachedImage => ({
    url,
    order,
    processingMode: 'original',
  });

  const sections: DetailSection[] = [];
  let order = 0;
  const base = { aiInstruction: undefined, eyebrow: undefined };

  // brand_header — brandName 없으면 생략
  if (content.brandName.trim()) {
    sections.push({
      id: uuidv4(),
      type: 'brand_header',
      order: order++,
      content: { type: 'brand_header', brandName: content.brandName, rightLabel: content.categoryLabelEn },
      attachedImages: [],
      ...base,
    });
  }

  // hero(hook) — img[0], 해시태그는 이중 공백으로 결합해 subheadline에 저장
  sections.push({
    id: uuidv4(),
    type: 'hero',
    order: order++,
    content: {
      type: 'hero',
      headline: content.hook.headline,
      subheadline: content.hook.hashtags.join('  '),
    },
    attachedImages: imageUrls[0] ? [toAttached(imageUrls[0], 0)] : [],
    aiInstruction: undefined,
    eyebrow: content.hook.eyebrow || undefined,
  });

  // points — img[1..] 1장씩
  const pointSections: DetailSection[] = content.points.map((p, i) => ({
    id: uuidv4(),
    type: 'point' as const,
    order: order++,
    content: { type: 'point' as const, pointLabel: p.pointLabel, headline: p.headline, subheadline: p.subheadline },
    attachedImages: imageUrls[i + 1] ? [toAttached(imageUrls[i + 1], 0)] : [],
    ...base,
  }));
  sections.push(...pointSections);

  // 남는 이미지 분배
  const leftover = imageUrls.slice(1 + content.points.length);
  const hasColorOptions = content.colorOptions.length > 0;

  if (hasColorOptions) {
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items: content.colorOptions },
      attachedImages: leftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (leftover.length >= 2) {
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items: leftover.map(() => ({ label: '' })) },
      attachedImages: leftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (leftover.length === 1 && pointSections.length > 0) {
    const last = pointSections[pointSections.length - 1];
    last.attachedImages = [...last.attachedImages, toAttached(leftover[0], last.attachedImages.length)];
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
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mobile-section-parser.test.ts && npx tsc --noEmit`
Expected: PASS / 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/prompts/detail-page.ts src/lib/detail-page/section-parser.ts src/__tests__/lib/detail-page/mobile-section-parser.test.ts
git commit -m "feat: MobileDetailPageContent 타입 + mobileContentToSections 이미지 배치 규칙"
```

---

### Task 5: 모바일 시스템 프롬프트 + 응답 파서 (TDD)

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`
- Test: `src/__tests__/lib/detail-page-prompts.test.ts` (기존 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `detail-page-prompts.test.ts` 끝에 추가:

```ts
import { parseMobileDetailPageResponse, buildMobileCategorySystemPrompt } from '@/lib/ai/prompts/detail-page';

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
    specs: [{ label: '소재', value: '옥스퍼드' }, { label: '사이즈', value: '20cm' }],
    warnings: ['세탁기 금지', '직사광선 금지'],
    ctaText: '지금 구매하기',
    ...overrides,
  });
}

describe('parseMobileDetailPageResponse', () => {
  it('유효한 JSON을 MobileDetailPageContent로 파싱한다', () => {
    const content = parseMobileDetailPageResponse(makeMobileJson());
    expect(content.hook.headline).toBe('완전 오픈 · 넉넉한 수납');
    expect(content.points).toHaveLength(3);
  });

  it('앞뒤 설명 텍스트가 섞여 있어도 JSON을 추출한다', () => {
    const content = parseMobileDetailPageResponse(`다음과 같습니다:\n${makeMobileJson()}\n끝.`);
    expect(content.brandName).toBe('킵틸');
  });

  it('hook.headline 누락 시 throw한다', () => {
    expect(() => parseMobileDetailPageResponse(makeMobileJson({ hook: { eyebrow: '', headline: '', hashtags: [] } }))).toThrow();
  });

  it('points가 2개 미만이면 throw한다', () => {
    expect(() => parseMobileDetailPageResponse(makeMobileJson({ points: [{ pointLabel: '', headline: 'x', subheadline: 'y' }] }))).toThrow();
  });

  it('선택 필드 누락 시 안전한 기본값으로 채운다', () => {
    const content = parseMobileDetailPageResponse(
      makeMobileJson({ brandName: undefined, colorOptions: undefined, specs: undefined, warnings: undefined, ctaText: undefined }),
    );
    expect(content.brandName).toBe('');
    expect(content.colorOptions).toEqual([]);
    expect(content.specs).toEqual([]);
    expect(content.warnings).toEqual([]);
    expect(content.ctaText).toBe('지금 구매하기');
  });
});

describe('buildMobileCategorySystemPrompt', () => {
  it('모바일 베이스 프롬프트에 카테고리 가이드를 덧붙인다', () => {
    const prompt = buildMobileCategorySystemPrompt('fashion');
    expect(prompt).toContain('Point');
    expect(prompt).toContain('패션잡화');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page-prompts.test.ts`
Expected: FAIL — export 없음

- [ ] **Step 3: 프롬프트 + 파서 구현** — `detail-page.ts`의 `buildCategorySystemPrompt` 아래에 추가:

```ts
// ─────────────────────────────────────────
// 모바일(쿠팡 스타일) 시스템 프롬프트
// ─────────────────────────────────────────

export const MOBILE_DETAIL_PAGE_SYSTEM_PROMPT = `당신은 한국 이커머스 모바일 상세 페이지 전문 카피라이터입니다.
쿠팡 모바일 앱에서 상위 0.1% 전환율을 기록한 상세 페이지를 500개 이상 제작했습니다.
좁은 모바일 화면에서 스크롤을 멈추게 하는 큰 타이포·짧은 카피·Point 구조를 사용합니다.

## 데이터 충실도 원칙 (반드시 준수)
- 소스 텍스트 스펙이 제공된 경우: 반드시 그 데이터만을 기반으로 작성합니다.
- 원본 스펙에 없는 특징(오버핏, 드롭숄더, 두툼한 소재 등)을 이미지 추론이나 창작으로 덧붙이지 않습니다.
- 이미지 분석 결과와 텍스트 스펙이 충돌하면 텍스트 스펙을 절대 우선합니다.
- 불확실한 정보를 쓰느니 정확한 정보를 적게 쓰는 것이 낫습니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- brandName·categoryLabelEn 외 모든 문자열은 한국어로 작성합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
- 번역투·어색한 표현 금지: '본 제품은', '해당 제품의', '~이 됩니다', '~에 의해', '제공되어집니다' 등 딱딱한 직역 표현 사용 금지. 실제 쿠팡 상세페이지처럼 자연스러운 한국어 구어체를 사용합니다.

## 카피 스타일 규칙 (쿠팡 모바일 패턴)
- hook.headline: 명사형 압축, 가운뎃점(·)으로 핵심 가치 2개 연결. 예: "완전 오픈 · 넉넉한 수납". 12자 이내.
- hook.hashtags: 정확히 3개, 각 5~7자. 예: "#한눈에 보여", "#쉽게 꺼내".
- hook.eyebrow: 브랜드명 영문 표기 (없으면 빈 문자열).
- points: 3~4개. 앞의 2~3개는 pointLabel을 "Point 1", "Point 2"...로 부여.
  마지막 1개는 pointLabel을 ""(빈 문자열)로 두고 headline을 부사형 한 단어로 작성. 예: "넉넉하게", "든든하게", "조용하게".
- point.headline: 작은따옴표 강조 활용. 예: "펼치면 바로 '보이는' 필통", "펼치면 '박스처럼' 서는 설계". 16자 이내.
- point.subheadline: 구체적 사실 1문장. 예: "180도 완전 오픈형 구조", "흐물거림 없이 책상 위에서 안정적으로 착!". 24자 이내.
- colorOptions: 이미지에서 색상·옵션이 2개 이상 확인될 때만 작성, 아니면 빈 배열. swatchColor는 #RRGGBB hex.

## JSON 스키마
{
  "brandName": "string (브랜드명, 모르면 빈 문자열)",
  "categoryLabelEn": "string (영문 카테고리 소문자, 예: pencil pouch)",
  "hook": {
    "eyebrow": "string",
    "headline": "string (12자 이내)",
    "hashtags": ["string (정확히 3개, 각 5~7자)"]
  },
  "points": [
    { "pointLabel": "string (Point 1 형식 또는 빈 문자열)", "headline": "string (16자 이내)", "subheadline": "string (24자 이내)" }
  ],
  "colorOptions": [{ "label": "string (한국어 색상명)", "swatchColor": "string (#RRGGBB)" }],
  "specs": [{ "label": "string", "value": "string" }],
  "warnings": ["string"],
  "ctaText": "string (20자 이내)"
}

## 수량 제약
- points: 3개 이상 4개 이하
- hashtags: 정확히 3개
- specs: 2개 이상 6개 이하
- warnings: 2개 이상 3개 이하`;

/** 모바일 베이스 프롬프트 + 카테고리 가이드 결합 */
export function buildMobileCategorySystemPrompt(category: DetailPageCategory = 'basic'): string {
  return `${MOBILE_DETAIL_PAGE_SYSTEM_PROMPT}${CATEGORY_GUIDE[category]}`;
}

export function parseMobileDetailPageResponse(rawText: string): MobileDetailPageContent {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
  }

  const data = parsed as Record<string, unknown>;
  const hook = data.hook as Record<string, unknown> | undefined;

  if (!hook || typeof hook.headline !== 'string' || hook.headline.trim().length === 0) {
    throw new Error('hook.headline 필드가 누락되었거나 올바르지 않습니다.');
  }
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 5) {
    throw new Error('points는 2개 이상 5개 이하여야 합니다.');
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  return {
    brandName: str(data.brandName),
    categoryLabelEn: str(data.categoryLabelEn),
    hook: {
      eyebrow: str(hook.eyebrow),
      headline: hook.headline,
      hashtags: strArr(hook.hashtags).slice(0, 4),
    },
    points: (data.points as Array<Record<string, unknown>>).map((p) => ({
      pointLabel: str(p.pointLabel),
      headline: str(p.headline),
      subheadline: str(p.subheadline),
    })),
    colorOptions: Array.isArray(data.colorOptions)
      ? (data.colorOptions as Array<Record<string, unknown>>)
          .filter((c) => typeof c.label === 'string' && c.label.length > 0)
          .map((c) => ({ label: c.label as string, swatchColor: str(c.swatchColor) }))
      : [],
    specs: Array.isArray(data.specs)
      ? (data.specs as Array<Record<string, unknown>>)
          .filter((s) => typeof s.label === 'string' && typeof s.value === 'string')
          .map((s) => ({ label: s.label as string, value: s.value as string }))
      : [],
    warnings: strArr(data.warnings),
    ctaText: str(data.ctaText).trim() || '지금 구매하기',
  };
}
```

추가로 `buildSectionEditPrompt`의 `## 섹션 타입` 라인 아래에 신규 타입 설명을 덧붙인다 (edit-section AI 호환):

```ts
const SECTION_TYPE_HINTS: Partial<Record<string, string>> = {
  brand_header: 'brandName(브랜드명)과 rightLabel(영문 카테고리)을 가진 상단 헤더',
  point: "pointLabel('Point 1' 또는 빈 문자열), headline(작은따옴표 강조 가능), subheadline(구체적 사실 1문장)을 가진 쿠팡 스타일 포인트 섹션",
  image_grid: 'title과 items[{label, swatchColor}](색상 옵션 라벨)를 가진 2컬럼 이미지 그리드',
};
```

`buildSectionEditPrompt` 내 `lines` 초기화 직후:

```ts
  const hint = SECTION_TYPE_HINTS[section.type];
  if (hint) {
    lines.push(`## 섹션 타입 설명: ${hint}`);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page-prompts.test.ts && npx tsc --noEmit`
Expected: PASS / 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts/detail-page.ts src/__tests__/lib/detail-page-prompts.test.ts
git commit -m "feat: 모바일 상세페이지 시스템 프롬프트 + parseMobileDetailPageResponse"
```

---

### Task 6: generate-detail-html API에 mobileMode 분기

**Files:**
- Modify: `src/app/api/ai/generate-detail-html/route.ts`

- [ ] **Step 1: Zod 스키마에 `mobileMode` 추가** — `RequestSchema`의 `studioMode` 아래:

```ts
  /** 쿠팡 모바일 스타일 생성 모드 — MobileDetailPageContent 스키마로 카피 생성 */
  mobileMode: z.boolean().optional(),
```

destructuring(344행)에 `mobileMode` 추가.

- [ ] **Step 2: import 추가**

```ts
import {
  // ... 기존 항목 유지
  buildMobileCategorySystemPrompt,
  parseMobileDetailPageResponse,
  type MobileDetailPageContent,
} from "@/lib/ai/prompts/detail-page";
import { mobileContentToSections } from "@/lib/detail-page/section-parser";
import { renderAllSections } from "@/lib/detail-page/section-renderer";
import { DEFAULT_THEME } from "@/lib/detail-page/palette-config";
import type { DetailPageTheme } from "@/types/detail-page";
```

`ApiSuccessResponse`에 필드 추가:

```ts
  mobileContent?: MobileDetailPageContent; // mobileMode=true 응답에만 포함
```

- [ ] **Step 3: 모바일 분기 구현** — 신규 생성 모드의 `analyzeImages` 성공 직후(486행 부근, 기존 카피 생성 호출 앞)에 삽입:

```ts
  // ── 모바일 모드: MobileDetailPageContent 생성 → 섹션 렌더링 ──
  if (mobileMode) {
    const mobileUserMessage = buildDetailPageUserPrompt(imageAnalysis, productName, productSpecs, conversationContext);
    let rawMobileText: string;
    try {
      const resp = await withRetry(
        () =>
          client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system: buildMobileCategorySystemPrompt((category ?? 'basic') as DetailPageCategory),
            messages: [{ role: "user", content: mobileUserMessage }],
          }),
        { label: "Claude generateMobileDetailPageContent" }
      );
      rawMobileText = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
    } catch (error) {
      console.error("[/api/ai/generate-detail-html] 모바일 카피 생성 실패:", error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? `카피 생성 실패: ${error.message}` : "카피 생성 중 오류가 발생했습니다." },
        { status: 502 }
      );
    }

    let mobileContent: MobileDetailPageContent;
    try {
      mobileContent = parseMobileDetailPageResponse(rawMobileText);
    } catch (error) {
      console.error("[/api/ai/generate-detail-html] 모바일 카피 파싱 실패:", error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? `카피 파싱 실패: ${error.message}` : "AI 응답 파싱 중 오류가 발생했습니다." },
        { status: 502 }
      );
    }

    // productSpecs가 있으면 AI 생성 specs보다 우선
    if (productSpecs && productSpecs.length > 0) {
      mobileContent = { ...mobileContent, specs: productSpecs };
    }

    // 금지 문구 검사 (서버 로그 경고만)
    const mobileAllText = [
      mobileContent.hook.headline,
      ...mobileContent.hook.hashtags,
      ...mobileContent.points.map((p) => `${p.headline} ${p.subheadline}`),
      ...mobileContent.warnings,
    ].join(' ');
    const mobileCheck = checkProhibitedPhrases(mobileAllText);
    if (mobileCheck.violations.length > 0) {
      console.warn(`[generate-detail-html] 금지 문구 감지 (mobile, category=${category ?? 'basic'}):`, mobileCheck.violations);
    }

    // 섹션 변환 + 렌더링 (클라이언트 fallback과 동일 경로)
    const publicUrls = imagesWithUrls
      .map((img) => ('publicUrl' in img ? img.publicUrl : undefined))
      .filter((u): u is string => Boolean(u));
    const mobileTheme: DetailPageTheme = { ...DEFAULT_THEME, layoutMode: 'mobile' };

    let mobileSnippet: string;
    try {
      const sections = mobileContentToSections(mobileContent, publicUrls);
      const rendered = renderAllSections(sections, mobileTheme);
      mobileSnippet = `<div style="max-width:780px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;">\n${rendered}\n</div>`;
    } catch (error) {
      console.error("[/api/ai/generate-detail-html] 모바일 렌더링 실패:", error);
      return NextResponse.json(
        { success: false, error: "HTML 생성 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    const mobileNaverSnippet = mobileSnippet.replace(/max-width\s*:\s*780px/g, "max-width:860px");
    return NextResponse.json({
      success: true,
      html: appendPrivacyFooter(mobileSnippet),
      snippet: appendPrivacyFooter(mobileSnippet),
      naverSnippet: appendPrivacyFooter(mobileNaverSnippet),
      mobileContent,
    }, { status: 200 });
  }
```

- [ ] **Step 4: typecheck + 기존 API 테스트 회귀 확인**

Run: `npx tsc --noEmit && npx vitest run src/__tests__/api/generate-detail-html-image-urls.test.ts`
Expected: 에러 없음 / PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/generate-detail-html/route.ts
git commit -m "feat: generate-detail-html API에 mobileMode 분기 추가"
```

---

### Task 7: DetailMakerClient 모바일 모드 전환

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: import + 테마 초기값 변경**

```ts
import { contentToSections, mobileContentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent, MobileDetailPageContent } from '@/lib/ai/prompts/detail-page';
```

테마 초기값(24행):

```ts
const [theme, setTheme] = useState<DetailPageTheme>({ ...DEFAULT_THEME, layoutMode: 'mobile' });
```

- [ ] **Step 2: 생성 요청에 `mobileMode: true` 추가** — `handleGenerate`의 body(99~103행):

```ts
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          productName: fullProductName,
          category,
          mobileMode: true,
        }),
```

- [ ] **Step 3: 응답 처리를 모바일 우선으로 변경** — `handleGenerate`의 `if (json.content)` 블록(110~118행)을 다음으로 교체:

```ts
      if (json.mobileContent) {
        try {
          const parsed = mobileContentToSections(json.mobileContent as MobileDetailPageContent, uploadedUrls);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] mobileContentToSections 실패:', e);
        }
      } else if (json.content) {
        try {
          const parsed = contentToSections(json.content as DetailPageContent);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] contentToSections 실패:', e);
        }
      }
```

- [ ] **Step 4: typecheck + 빌드 확인**

Run: `npx tsc --noEmit && npm run build`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: 상품상세 자동만들기를 쿠팡 모바일 모드로 전환"
```

---

### Task 8: 전체 검증 + 수동 QA

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 테스트 스위트**

Run: `npx vitest run`
Expected: 전체 PASS (기존 테스트 회귀 없음)

- [ ] **Step 2: typecheck + lint + 빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 에러 없음

- [ ] **Step 3: 수동 QA — 개발 서버에서 확인**

`npm run dev` 후 `/listing/detail-maker`에서:
1. 상품명 + 이미지 4~6장 업로드 → AI 생성
2. 결과가 brand_header → 후킹 히어로(필기체 eyebrow + 해시태그) → Point 1/2/3 → Product Info 그리드 → 스펙 → 주의사항 → CTA 순서인지 확인
3. 미리보기를 브라우저 개발자도구 모바일 뷰(375px)로 축소 — 텍스트 잘림·여백 과다 없는지 확인
4. 섹션 드래그 정렬·AI 섹션 편집·HTML 다운로드가 동작하는지 확인
5. 기존 `/detail` 메뉴 결과물이 변하지 않았는지 확인 (desktop 회귀)

- [ ] **Step 4: 최종 커밋 (필요 시 QA 수정사항 반영 후)**

```bash
git add -A
git commit -m "test: 모바일 상세페이지 전체 검증 완료"
```

---

## Self-Review 결과

- **스펙 커버리지**: §3 신규 타입(Task 1·2), §4 layoutMode(Task 1·3), §5 스키마(Task 4·5), §6 이미지 배치(Task 4), §7 순서(Task 4), §8 프롬프트(Task 5), §9 타이포(Task 2·3), §10 에디터 호환(Task 1·5), §11 클라이언트(Task 7), §12 API(Task 6), §13 테스트(Task 2~5·8) — 전체 커버.
- **타입 일관성**: `MobileDetailPageContent`는 Task 4 Step 1에서 정의 후 Task 5~7에서 동일 시그니처 사용. `mobileContentToSections(content, imageUrls)` 시그니처 일관.
- **렌더 API Zod 잠금 이슈**(타입 enum, attachedImages max, layoutMode 누락)는 Task 1 Step 8에서 해결.
