# Claude Layout 섹션 설계

## 배경

현재 상세페이지 시스템은 14가지 고정된 섹션 타입(hero, point, bar_chart 등)으로 구성되어 있다. 각 타입마다 렌더러가 정해진 HTML 구조를 출력하므로, 레퍼런스 퀄리티 상세페이지의 다양한 레이아웃(방사형 성분 배치, 비교 인포그래픽, 대형 타이포 + 누끼 이미지 조합 등)을 표현하기 어렵다.

**목표:** Claude가 섹션별 레이아웃을 JSON 블록 DSL로 자유롭게 설계하고, 서버 렌더러가 안전하게 HTML로 조립. 누끼 이미지(사용자 업로드 or Gemini 생성 → Replicate 배경 제거)를 각 섹션에 통합.

---

## 설계 원칙 (Opus 4.8 리뷰 반영)

1. **자유 HTML 금지** — LLM 출력 HTML은 신뢰할 수 없는 입력으로 취급. Claude는 JSON DSL만 출력하고 서버가 렌더링.
2. **기존 편집 모델 유지** — `data-edit-path` 기반 인라인 편집을 `blocks[i].text` 경로로 지원.
3. **이미지 source of truth** — 기존 `section.attachedImages[]` 패턴 재사용. `attachedIndex`로 참조.
4. **색상 런타임 치환** — 색상은 렌더 시점에 팔레트에서 읽어 적용. 생성 시 박지 않음.
5. **병렬 실행** — Claude JSON 생성과 이미지 처리(Gemini/Replicate)를 동시에 실행.

---

## 데이터 모델

### `LayoutBlock` DSL

```typescript
type LayoutBlock =
  | { type: 'badge';       text: string; color?: 'primary' | 'accent' | 'neutral' }
  | { type: 'heading';     text: string; size: 'xl' | 'lg' | 'md'; bold?: boolean; color?: 'primary' | 'text' | 'accent' }
  | { type: 'subtext';     text: string; align?: 'left' | 'center' }
  | { type: 'image';       attachedIndex: number; width?: string; align?: 'center' | 'left' | 'right'; rounded?: boolean }
  | { type: 'stat_row';    items: Array<{ label: string; value: string; unit?: string }> }
  | { type: 'bullet_list'; items: string[]; icon?: 'dot' | 'check' | 'arrow' }
  | { type: 'columns';     cols: LayoutBlock[][]; gap?: number }
  | { type: 'divider' }
  | { type: 'spacer';      height: number }
```

### `ClaudeLayoutContent`

```typescript
export interface ClaudeLayoutContent {
  type: 'claude_layout';
  title: string;            // 섹션 제목 (data-edit-path="content.title" 인라인 편집 가능)
  blocks: LayoutBlock[];    // 순서대로 렌더링
  bgStyle?: 'white' | 'light' | 'dark' | 'primary';  // 배경 스타일 (팔레트 런타임 적용)
  padding?: 'normal' | 'compact' | 'wide';
}
```

---

## 파이프라인

```
사용자 입력 (title, points[], sectionHint, imageCount, imageSource[])
           │
           ├──────────────────────────────────────────┐
           ▼                                          ▼
① Claude JSON 생성                        ② 이미지 처리 (슬롯별 병렬)
   POST /api/ai/generate-claude-layout       source === 'upload'
   → LayoutBlock[] 반환                       → 사용자 URL → loadReferenceImages
   → attachedIndex 0..N-1 참조                → removeImageBackgrounds (Replicate)
                                               → uploadToSupabase → URL
                                             source === 'gemini'
                                               → generateFrameImage (Gemini)
                                               → removeImageBackgrounds (Replicate)
                                               → uploadToSupabase → URL
           │                                          │
           └──────────────┬───────────────────────────┘
                          ▼
           ③ section.attachedImages[] 업데이트
              + section.content.blocks 저장
                          │
                          ▼
           ④ section-renderer: renderClaudeLayout()
              blocks 순회 → 각 블록 타입 → 안전한 HTML 조립
              색상은 PaletteColors에서 런타임 참조
```

---

## API: `POST /api/ai/generate-claude-layout`

**요청:**
```typescript
{
  title: string;
  points: string[];          // 핵심 포인트 3~6개
  sectionHint?: string;      // 스토리보드 씬 설명
  imageCount: number;        // 사용할 이미지 슬롯 수 (0~3)
  themeHint?: string;        // 'dark_bg' | 'white_clean' | 'accent_callout'
}
```

**Claude 시스템 프롬프트 핵심:**
```
You are a Korean e-commerce detail page layout designer.
Output a JSON layout for one product detail section.

Return ONLY valid JSON matching this schema:
{
  "blocks": [...],   // LayoutBlock array
  "bgStyle": "white" | "light" | "dark" | "primary",
  "padding": "normal" | "compact" | "wide"
}

Block types available: badge, heading, subtext, image, stat_row,
bullet_list, columns, divider, spacer.

Image blocks use "attachedIndex": 0..N where N = imageCount-1.
Max imageCount images total across all image blocks.

Design principles:
- Large headlines (size: "xl") for main points
- Use columns for side-by-side layouts (image + text)
- badge block for eyebrow labels like "Point 1", "핵심 공정"
- stat_row for data comparisons with numbers
- Korean mobile detail page aesthetic
- Do NOT include HTML, CSS, or script in text values
```

**rate limit:** 분당 6회
**maxDuration:** 60s

---

## `section-renderer.ts` — `renderClaudeLayout()`

각 블록 타입을 서버 렌더러가 직접 HTML 조립 — sanitization 불필요.

```typescript
function renderClaudeLayout(
  content: ClaudeLayoutContent,
  section: DetailSection,
  colors: PaletteColors
): string {
  const bg = resolveBlockBg(content.bgStyle, colors);
  const pad = resolvePadding(content.padding);
  const blocksHtml = content.blocks.map(b =>
    renderLayoutBlock(b, section.attachedImages, colors)
  ).join('');
  return `<div ${sectionAttrs(section)} style="background:${bg};padding:${pad};">${blocksHtml}</div>`;
}

function renderLayoutBlock(
  block: LayoutBlock,
  images: AttachedImage[],
  colors: PaletteColors
): string {
  switch (block.type) {
    case 'badge':      return renderBadgeBlock(block, colors);
    case 'heading':    return renderHeadingBlock(block, colors);
    case 'subtext':    return renderSubtextBlock(block, colors);
    case 'image':      return renderImageBlock(block, images, colors);
    case 'stat_row':   return renderStatRowBlock(block, colors);
    case 'bullet_list': return renderBulletListBlock(block, colors);
    case 'columns':    return renderColumnsBlock(block, images, colors);
    case 'divider':    return `<hr style="border:none;border-top:1px solid ${colors.border};margin:12px 0;" />`;
    case 'spacer':     return `<div style="height:${block.height}px;"></div>`;
  }
}
```

**모든 텍스트 값은 `escapeHtml()` 통과 후 삽입** — Claude 출력이라도 신뢰하지 않음.

---

## UI 통합

### DetailMakerClient — `generateSceneImages()` 분기

```typescript
if (section.type === 'claude_layout') {
  // Claude JSON + 이미지 처리 병렬 실행
  const imageSlots = getSlotsFromSection(section);
  // imageSlots는 section.attachedImages[]에서 source/generationHint 읽음
  const imageSlots = section.attachedImages.map(img => ({
    source: img.source ?? 'upload',
    url: img.url,
    generationHint: img.generationHint,
  }));

  const [layoutRes, ...imageResults] = await Promise.allSettled([
    fetch('/api/ai/generate-claude-layout', { ... }),
    ...imageSlots.map(slot => processImageSlot(slot)),
  ]);

  if (layoutRes.status === 'fulfilled') {
    const { blocks, bgStyle, padding } = await layoutRes.value.json();
    // imageResults → attachedImages URL 업데이트
    const newImages = imageResults.map((r, i) =>
      r.status === 'fulfilled' ? { ...section.attachedImages[i], url: r.value.url } : section.attachedImages[i]
    );
    return { sectionId: section.id, blocks, bgStyle, padding, imageUrls: newImages.map(i => i.url) };
  }
  return null;
}
```

**부분 실패 처리:** 이미지 슬롯 일부 실패 시 해당 슬롯은 placeholder 이미지 사용, 생성 계속 진행.

### DetailMakerInputPanel — 편집 UI

`claude_layout` 섹션 카드:
- **제목** input (기존 방식과 동일)
- **핵심 포인트** 리스트 편집
- **이미지 슬롯** (최대 3개):
  - `[Gemini 생성]` / `[직접 업로드]` 토글
  - Gemini: 이미지 설명 input
  - 업로드: 파일 선택
- **[레이아웃 재생성]** 버튼 (Claude 재호출)
- **bgStyle** 드롭다운 (white / light / dark / primary)

---

## 변경 파일 범위

| 파일 | 작업 |
|------|------|
| `src/types/detail-page.ts` | `LayoutBlock` + `ClaudeLayoutContent` 추가, `SectionType`/`SectionContent` union 확장, `isClaudeLayoutContent` 타입가드, `AttachedImage`에 `source?: 'upload' \| 'gemini'` + `generationHint?: string` 추가 |
| `src/app/api/ai/generate-claude-layout/route.ts` | 신규 — Claude JSON DSL 생성 |
| `src/lib/detail-page/section-renderer.ts` | `renderClaudeLayout()` + 블록 렌더러 추가, `renderSection` switch 추가 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `claude_layout` 분기 추가 (병렬 실행) |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | `claude_layout` 섹션 편집 UI |

---

## 실패 시나리오

| 시나리오 | 처리 |
|----------|------|
| Claude JSON 파싱 실패 | 400/500 반환, 클라이언트 skip (원본 유지) |
| Gemini 이미지 생성 실패 | 해당 슬롯 placeholder, 나머지 계속 |
| Replicate 배경 제거 실패 | 원본 이미지(배경 포함) 사용, 경고 로그 |
| attachedIndex 범위 초과 | 해당 image 블록 렌더 skip |
| 미지원 블록 타입 | 해당 블록 skip, 나머지 렌더 계속 |

---

## 범위 외

- 블록 인라인 편집 (2차 — 현재는 재생성 방식)
- 데스크톱 레이아웃 분기 (2차 — 모바일 390px 기준)
- 블록 타입 추가 (지도, 공정 플로우 — 기존 infographic_steps 재사용 유도)
- 생성 결과 캐싱
