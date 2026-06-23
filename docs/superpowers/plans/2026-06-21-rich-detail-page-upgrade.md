# Rich 상세페이지 업그레이드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지 자동생성에 6개 richSections(POINT/수치/바차트/WHY/인증/인포그래픽)을 추가하고, Gemini AI 씬 이미지 자동 교체를 제거해 원본 업로드 이미지를 그대로 사용하도록 수정한다.

**Architecture:** 기존 `DetailPageContent`에 `richSections?: RichSections` 필드를 추가하는 점진적 확장. 파서(`contentToSections`)가 `selectedSections` 순서에 따라 rich 섹션을 parsing하고, 렌더러가 6개 새 타입을 HTML로 변환한다. Gemini 씬 자동 생성 제거 후 원본 업로드 이미지를 hero/selling_points/features에 배분하는 헬퍼를 추가한다.

**Tech Stack:** TypeScript, Next.js App Router, inline-style HTML renderer (쿠팡 제약), uuid

---

## 파일 맵

| 파일 | 작업 |
|------|------|
| `src/types/detail-page.ts` | `RichSections` 인터페이스, 6개 새 `SectionType`, 6개 새 Content 타입, 타입가드 추가 |
| `src/lib/ai/prompts/detail-page.ts` | `DetailPageContent`에 `richSections?: RichSections` 필드 추가 |
| `src/lib/detail-page/section-parser.ts` | `contentToSections()`에 richSections 파싱, `distributeImagesToSections()` 헬퍼, `createEmptySection()` 6개 케이스 추가 |
| `src/lib/detail-page/section-renderer.ts` | 6개 새 렌더러, `SECTION_LABELS` 확장, `renderSection()` switch 확장, 새 Content 타입 import |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | Gemini 자동 씬 생성 제거, 원본 이미지 배분 적용, 로딩 문구 업데이트 |

---

## Task 1: 타입 확장 (`src/types/detail-page.ts`)

**Files:**
- Modify: `src/types/detail-page.ts`

- [ ] **Step 1: `SectionType`에 6개 새 값 추가**

기존 `SectionType` union 끝에 추가:

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
  | 'point_section'
  | 'stat_callout'
  | 'bar_chart'
  | 'why_icons'
  | 'certifications'
  | 'infographic_steps';
```

- [ ] **Step 2: 6개 새 Content 인터페이스 추가**

`ImageGridContent` 블록 바로 뒤에 삽입:

```typescript
export interface PointSectionContent {
  type: 'point_section';
  items: Array<{
    number: number;
    title: string;
    description: string;
  }>;
}

export interface StatCalloutContent {
  type: 'stat_callout';
  items: Array<{
    value: string;
    label: string;
    description: string;
  }>;
}

export interface BarChartContent {
  type: 'bar_chart';
  items: Array<{
    label: string;
    percentage: number;
    displayValue: string;
  }>;
}

export interface WhyIconsContent {
  type: 'why_icons';
  items: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
}

export interface CertificationsContent {
  type: 'certifications';
  items: Array<{
    name: string;
    description: string;
  }>;
}

export interface InfographicStepsContent {
  type: 'infographic_steps';
  items: Array<{
    step: number;
    icon: string;
    title: string;
    description: string;
  }>;
}
```

- [ ] **Step 3: `SectionContent` union 확장**

기존 `SectionContent` 타입에 6개 추가:

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
  | PointSectionContent
  | StatCalloutContent
  | BarChartContent
  | WhyIconsContent
  | CertificationsContent
  | InfographicStepsContent;
```

- [ ] **Step 4: `RichSections` 인터페이스 추가**

`MoodPreset` 인터페이스 바로 앞에 삽입:

```typescript
export interface RichSections {
  selectedSections: ('point' | 'stat' | 'bar_chart' | 'why' | 'cert' | 'steps')[];
  pointSections?: Array<{ number: number; title: string; description: string }>;
  statCallouts?: Array<{ value: string; label: string; description: string }>;
  barChartItems?: Array<{ label: string; percentage: number; displayValue: string }>;
  whyIcons?: Array<{ icon: string; title: string; description: string }>;
  certifications?: Array<{ name: string; description: string }>;
  infographicSteps?: Array<{ step: number; icon: string; title: string; description: string }>;
}
```

- [ ] **Step 5: 6개 타입가드 추가**

기존 타입가드 블록 끝에 추가:

```typescript
export function isPointSectionContent(c: SectionContent): c is PointSectionContent {
  return c.type === 'point_section';
}
export function isStatCalloutContent(c: SectionContent): c is StatCalloutContent {
  return c.type === 'stat_callout';
}
export function isBarChartContent(c: SectionContent): c is BarChartContent {
  return c.type === 'bar_chart';
}
export function isWhyIconsContent(c: SectionContent): c is WhyIconsContent {
  return c.type === 'why_icons';
}
export function isCertificationsContent(c: SectionContent): c is CertificationsContent {
  return c.type === 'certifications';
}
export function isInfographicStepsContent(c: SectionContent): c is InfographicStepsContent {
  return c.type === 'infographic_steps';
}
```

- [ ] **Step 6: TypeScript 타입 검사**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -v "\.next" | head -20
```

Expected: 이 파일 관련 새 에러 없음 (다른 파일에서 `SectionContent` 미처리 에러 발생하면 다음 Task에서 해결)

---

## Task 2: `DetailPageContent`에 `richSections` 필드 추가 (`src/lib/ai/prompts/detail-page.ts`)

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`

- [ ] **Step 1: import 추가**

파일 상단 `import type { DetailSection }` 아래에 추가:

```typescript
import type { RichSections } from '@/types/detail-page';
```

- [ ] **Step 2: `DetailPageContent`에 필드 추가**

기존 `DetailPageContent` 인터페이스의 `ctaText: string;` 뒤에 추가:

```typescript
  richSections?: RichSections;
```

- [ ] **Step 3: TypeScript 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "\.next" | head -20
```

Expected: 새 타입 에러 없음

---

## Task 3: 파서 확장 (`src/lib/detail-page/section-parser.ts`)

**Files:**
- Modify: `src/lib/detail-page/section-parser.ts`

- [ ] **Step 1: `distributeImagesToSections` 헬퍼 추가**

`reorderSections` 함수 바로 앞에 삽입:

```typescript
/**
 * 생성된 섹션에 업로드된 원본 이미지를 순서대로 배분한다.
 * hero → img[0], selling_points → img[1], features → img[2]  순으로 할당.
 * 이미지가 섹션보다 적으면 나머지 이미지 대상 섹션은 attachedImages 빈 채로 유지.
 */
export function distributeImagesToSections(
  sections: DetailSection[],
  imageUrls: string[],
): DetailSection[] {
  const IMAGE_TARGETS: SectionType[] = ['hero', 'selling_points', 'features'];
  let imgIdx = 0;
  return sections.map(s => {
    if (imgIdx >= imageUrls.length) return s;
    if (!IMAGE_TARGETS.includes(s.type)) return s;
    const url = imageUrls[imgIdx++];
    return {
      ...s,
      attachedImages: [{ url, order: 0, processingMode: 'original' as const }],
    };
  });
}
```

- [ ] **Step 2: `contentToSections`에 richSections 파싱 추가**

`contentToSections` 함수 내 `selling_points` 섹션 push 코드 **이후, features push 코드 이전**에 삽입:

```typescript
  // richSections — AI가 selectedSections 순서대로 지정한 rich 섹션들
  if (content.richSections?.selectedSections?.length) {
    const rich = content.richSections;
    for (const key of rich.selectedSections) {
      switch (key) {
        case 'point':
          if (rich.pointSections && rich.pointSections.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'point_section',
              order: order++,
              content: { type: 'point_section', items: rich.pointSections },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'stat':
          if (rich.statCallouts && rich.statCallouts.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'stat_callout',
              order: order++,
              content: { type: 'stat_callout', items: rich.statCallouts },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'bar_chart':
          if (rich.barChartItems && rich.barChartItems.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'bar_chart',
              order: order++,
              content: { type: 'bar_chart', items: rich.barChartItems },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'why':
          if (rich.whyIcons && rich.whyIcons.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'why_icons',
              order: order++,
              content: { type: 'why_icons', items: rich.whyIcons },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'cert':
          if (rich.certifications && rich.certifications.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'certifications',
              order: order++,
              content: { type: 'certifications', items: rich.certifications },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'steps':
          if (rich.infographicSteps && rich.infographicSteps.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'infographic_steps',
              order: order++,
              content: { type: 'infographic_steps', items: rich.infographicSteps },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
      }
    }
  }
```

- [ ] **Step 3: `createEmptySection`에 6개 케이스 추가**

기존 `case 'image_grid':` 케이스 뒤에 추가:

```typescript
    case 'point_section':
      return { ...base, type: 'point_section', content: { type: 'point_section', items: [] } };
    case 'stat_callout':
      return { ...base, type: 'stat_callout', content: { type: 'stat_callout', items: [] } };
    case 'bar_chart':
      return { ...base, type: 'bar_chart', content: { type: 'bar_chart', items: [] } };
    case 'why_icons':
      return { ...base, type: 'why_icons', content: { type: 'why_icons', items: [] } };
    case 'certifications':
      return { ...base, type: 'certifications', content: { type: 'certifications', items: [] } };
    case 'infographic_steps':
      return { ...base, type: 'infographic_steps', content: { type: 'infographic_steps', items: [] } };
```

- [ ] **Step 4: TypeScript 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "\.next" | head -30
```

Expected: section-parser.ts 관련 에러 없음 (renderer에서 새 타입 미처리 에러는 Task 4에서 해결)

---

## Task 4: 렌더러 확장 (`src/lib/detail-page/section-renderer.ts`)

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`

- [ ] **Step 1: 새 Content 타입 import 추가**

기존 import 블록에 6개 추가:

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
  PointSectionContent,
  StatCalloutContent,
  BarChartContent,
  WhyIconsContent,
  CertificationsContent,
  InfographicStepsContent,
} from '@/types/detail-page';
```

- [ ] **Step 2: `SECTION_LABELS` 확장**

기존 `SECTION_LABELS` 객체에 6개 항목 추가:

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
  point_section: 'POINT 섹션',
  stat_callout: '수치 강조',
  bar_chart: '바 차트',
  why_icons: 'WHY 아이콘',
  certifications: '인증 배지',
  infographic_steps: '사용법 인포그래픽',
};
```

- [ ] **Step 3: 6개 렌더 함수 추가**

`renderSection` 함수 바로 앞에 삽입:

```typescript
// ─────────────────────────────────────────
// Rich 섹션 렌더러 (6종)
// ─────────────────────────────────────────

function renderPointSection(content: PointSectionContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:12px;display:flex;gap:20px;align-items:flex-start;">
      <div style="flex-shrink:0;"><div style="background:#1e293b;color:#ffffff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;letter-spacing:1px;">POINT ${escapeHtml(String(item.number))}</div></div>
      <div>
        <div style="font-size:18px;font-weight:800;color:${colors.text};margin-bottom:6px;">${editableText(`content.items[${i}].title`, item.title)}</div>
        <div style="font-size:13px;color:${colors.textSub};line-height:1.6;">${editableText(`content.items[${i}].description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;">${itemsHtml}</div>`;
}

function renderStatCallout(content: StatCalloutContent, section: DetailSection): string {
  const cols = Math.min(content.items.length, 3);
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:12px;padding:20px 16px;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#f8fafc;line-height:1.2;">${editableText(`content.items[${i}].value`, item.value)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${editableText(`content.items[${i}].label`, item.label)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">${editableText(`content.items[${i}].description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderBarChart(content: BarChartContent, section: DetailSection, colors: PaletteColors): string {
  const maxPct = Math.max(...content.items.map(i => i.percentage), 1);
  const itemsHtml = content.items.map((item, i) => {
    const barWidth = Math.min(Math.round((item.percentage / maxPct) * 100), 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <span style="font-size:13px;color:#334155;width:100px;flex-shrink:0;">${editableText(`content.items[${i}].label`, item.label)}</span>
      <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${barWidth}%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:4px;"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#6366f1;width:50px;text-align:right;flex-shrink:0;">${editableText(`content.items[${i}].displayValue`, item.displayValue)}</span>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="background:#f8fafc;border-radius:12px;padding:20px;">${itemsHtml}</div></div>`;
}

function renderWhyIcons(content: WhyIconsContent, section: DetailSection, colors: PaletteColors): string {
  const cols = Math.min(content.items.length, 4);
  const itemsHtml = content.items.map((item, i) =>
    `<div style="text-align:center;padding:16px 8px;">
      <div style="font-size:28px;margin-bottom:8px;">${escapeHtml(item.icon)}</div>
      <div style="font-size:13px;font-weight:700;color:${colors.text};margin-bottom:4px;">${editableText(`content.items[${i}].title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};line-height:1.4;">${editableText(`content.items[${i}].description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderCertifications(content: CertificationsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="border:2px solid #e2e8f0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
      <div style="font-size:24px;">✅</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:${colors.text};">${editableText(`content.items[${i}].name`, item.name)}</div>
        <div style="font-size:11px;color:${colors.textSub};margin-top:2px;">${editableText(`content.items[${i}].description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;gap:12px;flex-wrap:wrap;">${itemsHtml}</div></div>`;
}

function renderInfographicSteps(content: InfographicStepsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) => {
    const isLast = i === content.items.length - 1;
    const arrow = isLast ? '' : `<div style="position:absolute;right:-10px;top:18px;color:#94a3b8;font-size:18px;z-index:1;">→</div>`;
    return `<div style="flex:1;text-align:center;position:relative;">
      ${arrow}
      <div style="width:36px;height:36px;background:#6366f1;color:#ffffff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;margin:0 auto 8px;">${escapeHtml(String(item.step))}</div>
      <div style="font-size:24px;margin-bottom:6px;">${escapeHtml(item.icon)}</div>
      <div style="font-size:12px;font-weight:700;color:${colors.text};margin-bottom:3px;">${editableText(`content.items[${i}].title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};">${editableText(`content.items[${i}].description`, item.description)}</div>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;align-items:flex-start;gap:0;">${itemsHtml}</div></div>`;
}
```

- [ ] **Step 4: `renderSection()` switch에 6개 case 추가**

기존 `case 'image_grid':` 케이스 뒤에 추가:

```typescript
    case 'point_section':
      return renderPointSection(section.content as PointSectionContent, section, colors);
    case 'stat_callout':
      return renderStatCallout(section.content as StatCalloutContent, section);
    case 'bar_chart':
      return renderBarChart(section.content as BarChartContent, section, colors);
    case 'why_icons':
      return renderWhyIcons(section.content as WhyIconsContent, section, colors);
    case 'certifications':
      return renderCertifications(section.content as CertificationsContent, section, colors);
    case 'infographic_steps':
      return renderInfographicSteps(section.content as InfographicStepsContent, section, colors);
```

- [ ] **Step 5: TypeScript 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "\.next" | head -30
```

Expected: 새 에러 없음 (기존 에러가 있다면 section-renderer.ts 관련 에러 없어야 함)

---

## Task 5: 이미지 고정 + 로딩 문구 (`src/app/listing/detail-maker/DetailMakerClient.tsx`)

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: `distributeImagesToSections` import 추가**

파일 상단 `section-parser` import 줄에 추가:

```typescript
import { contentToSections, mobileContentToSections, distributeImagesToSections } from '@/lib/detail-page/section-parser';
```

- [ ] **Step 2: desktop 모드 파싱 후 이미지 배분 적용**

기존 `contentToSections(json.content as DetailPageContent)` 이후 코드를 찾아 교체:

**기존 (lines 454-462 근방):**
```typescript
        parsed = contentToSections(json.content as DetailPageContent);
        setSections(parsed);
        await refreshRenderedHtml(parsed, theme);
```

**변경 후:**
```typescript
        const rawSections = contentToSections(json.content as DetailPageContent);
        parsed = distributeImagesToSections(rawSections, uploadedUrls);
        setSections(parsed);
        await refreshRenderedHtml(parsed, theme);
```

- [ ] **Step 3: Gemini 씬 자동 생성 블록 제거**

다음 블록 전체 삭제:

```typescript
      // Claude 생성 완료 → 즉시 페이지 표시 후 Gemini 씬 이미지 교체
      if (parsed && parsed.length > 0) {
        setIsGeneratingScenes(true);
        void generateSceneImages(parsed, uploadedUrls, currentGenId, theme, creativeBrief?.sceneHint).finally(() => {
          if (sceneGenIdRef.current === currentGenId) setIsGeneratingScenes(false);
        });
      }
```

> **주의:** `isGeneratingScenes` state와 `generateSceneImages` 함수 자체는 유지한다. 섹션별 수동 씬 재생성(`handleSceneEdit`)에서 계속 사용하기 때문이다. 자동 호출만 제거.

- [ ] **Step 4: 로딩 문구 업데이트**

기존 (line 634 근방):
```typescript
<div style={{ fontSize: '13px' }}>잠시만 기다려주세요 (30~60초 소요)</div>
```

변경 후:
```typescript
<div style={{ fontSize: '13px' }}>AI 상세페이지 생성 중... (약 30초 소요)</div>
```

- [ ] **Step 5: TypeScript + 빌드 검사**

```bash
npx tsc --noEmit 2>&1 | grep -v "\.next" | head -30
```

Expected: 새 에러 없음

---

## Task 6: 통합 검증

- [ ] **Step 1: 개발 서버 확인**

```bash
# 이미 실행 중이면 건너뜀
curl -s http://localhost:3000/listing/detail-maker -o /dev/null -w "%{http_code}"
```

Expected: `200`

- [ ] **Step 2: 기능 검증 체크리스트 (수동)**

브라우저에서 `/listing/detail-maker` 접속:

1. **이미지 고정 확인**: 상품 이미지 3장 업로드 → AI 생성 → hero/selling_points/features에 업로드 원본 이미지가 그대로 표시되는지 확인 (Gemini AI 씬 이미지로 바뀌지 않아야 함)

2. **richSections 렌더링 확인**: 건강기능식품 이미지 업로드 → AI 생성 → POINT 섹션, 수치 강조, 바 차트 섹션 등이 페이지에 렌더링되는지 확인

3. **섹션 편집 확인**: rich 섹션 클릭 → 텍스트 수정 가능한지 확인 (기존 edit-section API 재사용)

4. **로딩 문구 확인**: AI 생성 버튼 클릭 후 "AI 상세페이지 생성 중... (약 30초 소요)" 표시 확인

5. **AI 씬 배너 없음 확인**: 초기 생성 시 "AI 씬 이미지 생성 중..." 배너가 뜨지 않는 것 확인 (수동 씬 편집은 여전히 동작해야 함)

- [ ] **Step 3: 커밋**

```bash
git add src/types/detail-page.ts \
        src/lib/ai/prompts/detail-page.ts \
        src/lib/detail-page/section-parser.ts \
        src/lib/detail-page/section-renderer.ts \
        src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-maker): rich 섹션 6종 추가 + 원본 이미지 고정"
```
