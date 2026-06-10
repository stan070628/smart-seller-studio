# 상품상세 자동만들기 — 구현 스펙 v3

**날짜:** 2026-06-11
**진입 URL:** `/listing/detail-maker`
**작성 기준:** 코드베이스 실측 (DetailPageEditor / AssetsResultPanel / 3개 API 라우트 / upload-image / section-parser / AppShell / palette-config / detail-page 타입)
**v2 대비 변경:** 모든 API 계약·Props·타입을 실제 코드와 100% 대조. 불일치 항목(테마 palette enum 9종 vs render API 5종, upload 응답 구조, content→sections 변환 throw 조건)을 명시적으로 반영.

---

## 1. 목표

판매자가 **상품명 + 이미지 1~6장**(권장 3장)만으로 고품질 상세페이지를 1분 내에 생성하고, 인라인/섹션 단위로 편집한 뒤 HTML을 다운로드한다. **크레딧 시스템 제외.**

---

## 2. 핵심 원칙 — 기존 코드 최대 재사용

| 기능 | 재사용 자산 | 신규 여부 |
|------|------------|-----------|
| AI 상세페이지 생성 | `POST /api/ai/generate-detail-html` | 재사용 |
| 섹션 편집(텍스트/이미지/이동/삭제/AI재생성/테마) | `DetailPageEditor.tsx` (+ 내장 `ThemeBar`, `SectionCard`) | 재사용 |
| HTML 재렌더(편집 반영) | `POST /api/detail-page/render` | 재사용 |
| 섹션 AI 편집 | `POST /api/detail-page/edit-section` | 재사용 |
| 이미지 업로드 | `POST /api/listing/upload-image` | 재사용 |
| content → 섹션 변환 | `contentToSections()` (`section-parser.ts`) | 재사용 |
| 섹션 이미지 AI 편집 모달 | `AiEditModal` (`context="detail"`) | 재사용 |
| 좌측 네비 진입점 | `AppShell` `NAV_ITEMS` children | 수정 |
| 페이지 라우트 + 입력 폼 + 좌측 도구 패널 | — | **신규** |
| 에셋 라이브러리(SVG 아이콘) | — | **신규 (Phase 2)** |

---

## 3. 레이아웃 (2패널)

```
┌─────────────────────────────────────────────────────────────────┐
│ AppShell 사이드바(220px) │  detail-maker 페이지                  │
│                          │ ┌───────────────┬──────────────────┐ │
│                          │ │ 좌측 패널 300px│ 우측 DetailPageEditor│ │
│                          │ │ (입력/도구)    │ (sections 편집+미리보기)│ │
│                          │ └───────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- **좌측 300px 고정 패널** = 신규 입력/도구 패널 (`DetailMakerInputPanel`).
- **우측 가변폭** = 기존 `DetailPageEditor` 그대로. `hidePreview`를 **false(기본)** 로 두어 내부 좌측 300px(섹션 카드/테마/액션) + 내부 우측 iframe 미리보기를 모두 사용한다.
  - 즉 화면에는 좌→우로 `[입력패널 300px][에디터-섹션패널 300px][에디터-미리보기 가변]` 3열이 나란히 놓인다. 이는 의도된 구성이며 `AssetsResultPanel`이 `DetailPageEditor`를 임베드한 방식과 동일하다.
- **레이아웃 중복 주의:** `src/app/listing/layout.tsx`가 이미 `<AppShell>{children}</AppShell>`로 감싼다. **detail-maker 페이지에서 AppShell을 다시 감싸면 안 된다.** 페이지는 AppShell 내부 콘텐츠만 렌더한다.
- 페이지 루트는 `height: 100%` + `display: flex`로 좌/우 패널을 채운다. AppShell의 메인 영역은 기본 `mainOverflow='auto'`, `mainDisplay='block'`이므로, 전체 높이 flex 레이아웃이 필요하면 페이지 컨테이너에 `height: 'calc(100vh - 0px)'` 대신 `height: '100%'`와 부모 flex를 쓴다(상세는 §7 참고).

---

## 4. 라우트 / 파일 구성

| 경로 | 역할 | 신규/수정 |
|------|------|-----------|
| `src/app/listing/detail-maker/page.tsx` | 페이지 (Server Component shell) | 신규 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `'use client'` 메인 컨테이너 (상태·API 호출) | 신규 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 좌측 300px 입력/도구 패널 | 신규 |
| `src/components/AppShell.tsx` | `상품등록` 항목 children에 메뉴 추가 | 수정 |

> `next/dist/docs/`의 App Router 가이드 확인 후 작성할 것 (AGENTS.md 지시). `page.tsx`는 서버 컴포넌트로 두고 실제 인터랙션은 `DetailMakerClient.tsx`(`'use client'`)에 둔다.

### 4.1 page.tsx (서버 컴포넌트 shell)

```tsx
// src/app/listing/detail-maker/page.tsx
import DetailMakerClient from './DetailMakerClient';

export default function DetailMakerPage() {
  return <DetailMakerClient />;
}
```

AppShell은 `listing/layout.tsx`가 제공하므로 여기서 다시 감싸지 않는다.

---

## 5. AppShell 메뉴 추가 (수정)

`NavChild = { href: string; label: string; icon: React.ReactNode }` — 3필드 모두 필수.

`/listing` 항목의 기존 `children`(에디터 1개)에 항목을 **추가**한다. `href`는 실제 경로 `/listing/detail-maker`를 그대로 쓴다. (`isActive`는 `pathname.startsWith(href)`로 동작하므로 전체 경로 사용)

```tsx
// NAV_ITEMS 내 href: '/listing' 항목의 children 배열에 추가
{
  href: '/listing/detail-maker',
  label: '상품상세 자동만들기',
  icon: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5" />
      <path d="M4 9h16M9 9v11" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
},
```

> 기존 children 항목의 `href: '/editor'`는 `isActive('/editor')`가 `pathname.startsWith('/editor')`로 평가되어 `/listing` 외부 경로를 가리킨다(주의: 이는 기존 버그 가능성이나 본 작업 범위 밖). 신규 항목은 `/listing/detail-maker` 전체 경로를 사용한다.

---

## 6. 상태 모델 (DetailMakerClient)

`AssetsResultPanel`은 `useListingStore`의 `assetsDraft`를 사용하지만, detail-maker는 **독립 페이지**이므로 store를 오염시키지 않고 **로컬 컴포넌트 state**로 관리한다. 타입은 `@/types/detail-page`를 그대로 사용한다.

```ts
import type { DetailSection, DetailPageTheme, AttachedImage } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';

// 입력
const [productName, setProductName] = useState('');
const [brandName, setBrandName] = useState('');               // 선택 — productSpecs/conversationContext 없이는 미전달
const [category, setCategory] = useState<'basic'|'fashion'|'living'|'food'>('basic');
const [uploadedUrls, setUploadedUrls] = useState<string[]>([]); // 업로드 완료된 공개 URL (최대 6)
const [uploading, setUploading] = useState(false);

// 결과
const [sections, setSections] = useState<DetailSection[]>([]);
const [theme, setTheme] = useState<DetailPageTheme>(DEFAULT_THEME);
const [generatedHtml, setGeneratedHtml] = useState<string>('');
const [aiContent, setAiContent] = useState<DetailPageContent | null>(null);

// 진행 상태
const [isGenerating, setIsGenerating] = useState(false); // AI 생성 중
const [isRendering, setIsRendering] = useState(false);   // render API 중
const [error, setError] = useState<string | null>(null);
```

`DEFAULT_THEME`(palette-config) = `{ palette:'warm_cream', primaryColor:'#F5F0E8', accentColor:'#7A5C10', fontStyle:'mixed', imageLayout:'fullbleed' }`.

---

## 7. 페이지 컨테이너 레이아웃 (DetailMakerClient)

```tsx
'use client';
// ...imports
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';
import { C } from '@/lib/design-tokens';

return (
  <div style={{ display: 'flex', height: '100%', minHeight: '100vh', background: C.bg }}>
    {/* 좌측 300px 입력/도구 패널 */}
    <DetailMakerInputPanel
      productName={productName} setProductName={setProductName}
      brandName={brandName} setBrandName={setBrandName}
      category={category} setCategory={setCategory}
      uploadedUrls={uploadedUrls}
      uploading={uploading}
      isGenerating={isGenerating}
      error={error}
      onUploadFiles={handleUploadFiles}
      onRemoveImage={handleRemoveImage}
      onGenerate={handleGenerate}
    />

    {/* 우측 — 기존 DetailPageEditor (생성 후에만) */}
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      {sections.length > 0 ? (
        <DetailPageEditor
          sections={sections}
          theme={theme}
          isGenerating={isRendering}
          onSectionsChange={handleSectionsChange}
          onThemeChange={handleThemeChange}
          onSectionAiEdit={handleSectionAiEdit}
          onHtmlCopy={handleHtmlCopy}
          onDownload={handleDownload}
          generatedHtml={generatedHtml}
          // hidePreview 생략 → 기본 false → 내부 미리보기 iframe 사용
        />
      ) : (
        <EmptyState />  /* "상품 정보를 입력하고 생성해보세요" */
      )}
    </div>
  </div>
);
```

> `DetailPageEditor`는 내부적으로 `height: '100%'`를 사용하므로 부모 컨테이너가 명확한 높이를 가져야 한다. 따라서 페이지 루트에 `height: '100%'` + `minHeight: '100vh'`, 우측 래퍼에 `overflow: 'hidden'`을 둔다.

---

## 8. DetailPageEditor Props 연결 (실측 시그니처)

`DetailPageEditorProps` (DetailPageEditor.tsx L124–144):

| Prop | 타입 | detail-maker 연결 |
|------|------|-------------------|
| `sections` | `DetailSection[]` | `sections` state |
| `theme` | `DetailPageTheme` | `theme` state |
| `isGenerating?` | `boolean` | `isRendering` (로딩 오버레이용) |
| `onSectionsChange` | `(sections: DetailSection[]) => void` | §9.3 |
| `onThemeChange` | `(theme: DetailPageTheme) => void` | §9.4 |
| `onRegenerateAll?` | `() => void` | **생략** (전체 재생성은 좌측 입력 폼의 생성 버튼이 담당) |
| `onSectionAiEdit` | `(section: DetailSection, instruction: string) => Promise<void>` | §9.5 (필수) |
| `onHtmlCopy?` | `() => void` | §9.6 |
| `onDownload?` | `() => void` | §9.7 |
| `generatedHtml?` | `string` | `generatedHtml` state |
| `hidePreview?` | `boolean` | 생략(=false) |
| `onSectionImageAiEdit?` | `(sectionId, imageUrl, imageIndex) => void` | Phase 1.5 (선택) — 설정 시 `AiEditModal` `context="detail"` 연결, §11 |

> `onSectionAiEdit`는 **필수 prop**이다(옵셔널 아님). 반드시 전달해야 한다.

---

## 9. API 호출 핸들러 (실측 계약 100% 일치)

모든 API는 `requireAuth`로 쿠키 기반 인증한다. 클라이언트 `fetch`는 **same-origin 상대경로**이므로 `Authorization` 헤더·`credentials` 옵션 불필요(기존 `AssetsResultPanel`/`DetailClient`와 동일).

### 9.1 이미지 업로드 — `POST /api/listing/upload-image`

**요청:** `multipart/form-data`
- `file`: `File` (필드명 정확히 `file`) — image/jpeg|png|webp, 최대 10MB
- `usageContext`: 문자열, **`"listing_detail"`** (enum: `listing_thumbnail | listing_detail`)

**응답 (성공 201):**
```ts
{ success: true, data: { url: string; assetId: string; fileName: string; fileSize: number } }
```
**응답 (실패):** `{ success: false, error: string, code: ... }` (401/400/413/415/500/502)

```ts
async function uploadOne(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);                      // 필드명 정확히 'file'
  fd.append('usageContext', 'listing_detail');  // 정확한 enum 값
  const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error ?? `업로드 실패 (${res.status})`);
  return json.data.url as string;               // 공개 URL
}

async function handleUploadFiles(files: FileList | File[]) {
  setUploading(true); setError(null);
  try {
    const arr = Array.from(files).slice(0, 6 - uploadedUrls.length);
    const urls = await Promise.all(arr.map(uploadOne));
    setUploadedUrls(prev => [...prev, ...urls].slice(0, 6));
  } catch (e) {
    setError(e instanceof Error ? e.message : '이미지 업로드 실패');
  } finally { setUploading(false); }
}
```

> 업로드 라우트는 `Content-Type`을 직접 설정하지 말 것 — `FormData` 사용 시 브라우저가 boundary 포함 헤더를 자동 설정한다.

### 9.2 AI 생성 — `POST /api/ai/generate-detail-html`

**요청 바디** (RequestSchema, generate-detail-html/route.ts L78–123):
- `imageUrls`: `string[]` (URL, 최대 6) — 업로드된 공개 URL 전달
- `productName?`: `string` (≤100)
- `category?`: `'basic'|'fashion'|'living'|'food'` (기본 `'basic'`)
- (선택) `studioMode?`, `productSpecs?`, `includeImagePrompts?`, `conversationContext?` — **detail-maker Phase 1에서는 미사용**
- 제약: `images` 또는 `imageUrls` 중 하나 필수 → `imageUrls` 사용

**응답 (성공 200):**
```ts
{
  success: true;
  html: string;            // 개인정보 고지 포함 전체 HTML
  snippet: string;
  naverSnippet: string;
  content?: DetailPageContent;  // 신규 생성 모드에서 포함 — 섹션 편집기 초기화용
}
```
**실패:** `{ success: false, error: string }` (400/429/502/503/500)

```ts
async function handleGenerate() {
  if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
  if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }
  setIsGenerating(true); setError(null);
  try {
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: uploadedUrls,            // 최대 6
        productName: productName.trim(),
        category,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? `생성 실패 (${res.status})`);

    setGeneratedHtml(json.html);            // 즉시 미리보기 가능
    setAiContent(json.content ?? null);

    // content → sections 변환 (인라인 편집용 data-edit-path 확보를 위해 render 재호출)
    if (json.content) {
      try {
        const parsed = contentToSections(json.content);   // throw 가능 (§9.2.1)
        setSections(parsed);
        await refreshRenderedHtml(parsed, theme);          // data-edit-path 포함 HTML로 교체
      } catch (e) {
        // 변환 실패 시 sections 비움 → 우측은 generatedHtml만으로 레거시 미리보기 (편집 불가)
        console.warn('[detail-maker] contentToSections 실패:', e);
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : 'AI 생성 중 오류가 발생했습니다.');
  } finally { setIsGenerating(false); }
}
```

#### 9.2.1 `contentToSections(content)` throw 조건 (section-parser.ts L10–16)
- `content.headline`이 비어있으면 `throw 'headline must not be empty'`
- `content.ctaText`가 비어있으면 `throw 'ctaText must not be empty'`
- → 반드시 `try/catch`로 감쌀 것. throw 시 sections 미설정.
- 변환 규칙: hero/cta는 항상 생성, 나머지(selling_points/features/spec_table/usage_steps/warning)는 빈 배열이면 생략, `stats`는 생성 안 함(수동 추가만). `order`는 0부터 연속.

### 9.3 섹션 변경 반영 — `onSectionsChange`

`AssetsResultPanel` 패턴(L630–633)과 동일: state 갱신 후 render 재호출로 미리보기 동기화.

```ts
function handleSectionsChange(next: DetailSection[]) {
  setSections(next);
  void refreshRenderedHtml(next, theme);
}
```

### 9.4 테마 변경 — `onThemeChange`

```ts
function handleThemeChange(next: DetailPageTheme) {
  setTheme(next);
  void refreshRenderedHtml(sections, next);
}
```

### 9.5 섹션 AI 편집 — `onSectionAiEdit` → `POST /api/detail-page/edit-section`

**요청 바디** (edit-section/route.ts L28–77):
- `section`: 해당 `DetailSection` (id/type/order/content/attachedImages/aiInstruction/eyebrow)
- `instruction`: `string` (1~500)
- `theme`: `DetailPageTheme` — palette enum **9종 모두 허용**(rose_soft 등 포함)
- (선택) `productName?`, `existingSections?: Array<{ type: string; content: Record }>`

**응답 (성공 200):** `{ section: DetailSection, html: string }` — `html`은 해당 섹션 단일 렌더 결과(전체 아님)
**실패:** `{ error: string }` (400/429/500)

`AssetsResultPanel.handleSectionAiEdit`(L345–370) 패턴 그대로:

```ts
async function handleSectionAiEdit(section: DetailSection, instruction: string): Promise<void> {
  const res = await fetch('/api/detail-page/edit-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section,
      instruction,
      theme,
      productName: productName.trim() || undefined,
      existingSections: sections.map(s => ({ type: s.type, content: s.content })),
    }),
  });
  let json: Record<string, unknown>;
  try { json = await res.json(); }
  catch { throw new Error(`섹션 편집 실패 (${res.status})`); }
  if (!res.ok) throw new Error((json.error as string | undefined) ?? '섹션 편집 실패');

  const updatedSection = json.section as DetailSection;
  const updated = sections.map(s => s.id === section.id ? { ...s, ...updatedSection } : s);
  setSections(updated);
  await refreshRenderedHtml(updated, theme);   // 전체 미리보기 재렌더
}
```

> 응답의 `html`(단일 섹션)은 사용하지 않고, 전체 일관성을 위해 `refreshRenderedHtml`로 전체를 재렌더한다(AssetsResultPanel과 동일 전략).

### 9.6 HTML 복사 — `onHtmlCopy`

```ts
async function handleHtmlCopy() {
  await navigator.clipboard.writeText(generatedHtml).catch(() => {});
}
```

### 9.7 HTML 다운로드 — `onDownload`

`AssetsResultPanel`(L642–652) 패턴:

```ts
function handleDownload() {
  const blob = new Blob([generatedHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'detail-page.html';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

---

## 10. `refreshRenderedHtml` 헬퍼 — `POST /api/detail-page/render`

`AssetsResultPanel.refreshRenderedHtml`(L68–92) 패턴 복제.

**요청 바디** (render/route.ts L27–57):
- `sections`: `DetailSection[]` (1~20)
- `theme`: `DetailPageTheme`

> **⚠️ palette enum 불일치 (반드시 인지):** render API의 `theme.palette` enum은 **5종만 허용**(`warm_cream | cool_white | deep_dark | nature_green | tech_navy`). edit-section API는 9종 허용. `ThemeBar`가 `rose_soft/cream_cozy/sunset_warm/fresh_mint` 중 하나를 선택하면 **render API가 Zod 검증 400으로 거부**한다.
> → Phase 1에서는 안전하게 **render가 허용하는 5종 팔레트만 노출**하거나(권장), `renderError` 처리로 graceful fallback한다. 본 스펙은 render 호환 5종으로 좌측/내장 ThemeBar 사용을 권장하되, ThemeBar가 9종을 노출하면 §10.1 에러 처리를 반드시 둘 것. (ThemeBar 옵션 제한은 별도 컴포넌트 수정 필요 — 범위 결정 필요 항목.)
> 또한 `theme.primaryColor`/`accentColor`는 render API에서 **`#RRGGBB` 정규식 검증**(6자리)이 있으므로 3자리 hex 금지.

**응답 (성공 200):** `{ html: string; snippet: string }` (html은 개인정보 고지 포함, `data-edit-path`/`data-section-id` 포함된 인라인 편집 가능 HTML)
**실패:** `{ error: string }` (400/500)

```ts
async function refreshRenderedHtml(
  nextSections: DetailSection[] = sections,
  nextTheme: DetailPageTheme = theme,
) {
  if (nextSections.length === 0) return;
  setIsRendering(true); setError(null);
  try {
    const res = await fetch('/api/detail-page/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: nextSections, theme: nextTheme }),
    });
    const json = await res.json();
    if (res.ok) setGeneratedHtml(json.html);
    else setError(json.error ?? '미리보기 갱신에 실패했습니다.');
  } catch {
    setError('미리보기 갱신 중 오류가 발생했습니다.');
  } finally { setIsRendering(false); }
}
```

### 10.1 render 400 fallback
`renderError`가 palette 미허용으로 발생하면, 직전 `generatedHtml`을 유지(덮어쓰지 않음)하고 사용자에게 "이 테마는 미리보기 갱신을 지원하지 않습니다" 안내. (위 코드의 `setError` 분기로 충족.)

---

## 11. 섹션 이미지 AI 편집 (선택, Phase 1.5)

`onSectionImageAiEdit` prop 사용 시 `AssetsResultPanel`(L61–65, L133–147, L654–656, L711–720) 패턴 복제:

```ts
const [sectionImageEditTarget, setSectionImageEditTarget] =
  useState<{ sectionId: string; imageUrl: string; imageIndex: number } | null>(null);

// DetailPageEditor prop
onSectionImageAiEdit={(sectionId, imageUrl, imageIndex) =>
  setSectionImageEditTarget({ sectionId, imageUrl, imageIndex })}

// 모달 (AiEditModal, context="detail")
function handleSectionImageAiEditSaved(resultUrl: string) {
  if (!sectionImageEditTarget) return;
  const { sectionId, imageIndex } = sectionImageEditTarget;
  const updated = sections.map(s => {
    if (s.id !== sectionId) return s;
    const imgs = [...s.attachedImages];
    if (!imgs[imageIndex]) return s;
    imgs[imageIndex] = { ...imgs[imageIndex], url: resultUrl };
    return { ...s, attachedImages: imgs };
  });
  setSections(updated);
  void refreshRenderedHtml(updated, theme);
  setSectionImageEditTarget(null);
}
```

`AttachedImage` = `{ url: string; order: number; processingMode: 'original'|'bg_removed'|'bg_composed' }`. render/edit-section 모두 `attachedImages` 최대 2개, `url`은 유효 URL 필수.

---

## 12. 좌측 입력 패널 (DetailMakerInputPanel) — 신규 UI 스펙

너비 **300px 고정**, `borderRight: 1px solid C.border`, `background: C.bg`, 세로 flex + 내부 스크롤. 디자인 토큰 `C`(`@/lib/design-tokens`) 사용.

| 영역 | 내용 |
|------|------|
| 헤더 | "상품상세 자동만들기" 타이틀 |
| 상품명 `*` | `<input>` — `text-gray-900` 명시(MEMORY: 다크모드 가시성), `value=productName` |
| 카테고리 | 칩 4종: 기본/패션/리빙/식품 → `category` (`basic/fashion/living/food`) |
| 브랜드명 (선택) | `<input>` — Phase 1에서는 생성 요청에 미전달(향후 productSpecs 연동) |
| 참고 이미지 `*` (1~6, 권장 3) | 업로드 영역(클릭/드롭) → `handleUploadFiles`. 썸네일 그리드 + 개별 삭제(`onRemoveImage`). `uploading` 중 스피너 |
| 에러 | `error` 있으면 빨간 안내 박스 |
| 생성 버튼 | `onGenerate`, `disabled = isGenerating || !productName.trim() || uploadedUrls.length===0`. `isGenerating` 시 "생성 중..." |

```ts
function handleRemoveImage(idx: number) {
  setUploadedUrls(prev => prev.filter((_, i) => i !== idx));
}
```

**입력 가시성(MEMORY 규칙):** 모든 `<input>`에 `style={{ color: '#111' }}` 또는 `className="text-gray-900"` 명시. 다크모드 CSS 변수 의존 금지.

---

## 13. EmptyState (우측, 생성 전)

`sections.length === 0`일 때 표시. 중앙 정렬, `C.textSub`, "상품 정보를 입력하고 상세페이지를 생성해보세요." 안내. (DetailPageEditor 내부의 빈 미리보기와 별개 — 생성 전에는 에디터 자체를 마운트하지 않음.)

---

## 14. Phase 구분

| Phase | 범위 |
|-------|------|
| **1** | 라우트 + AppShell 메뉴 + 입력 패널 + 업로드 + AI 생성 → `contentToSections` → `DetailPageEditor` 연결(섹션 편집/드래그/인라인/테마/AI섹션편집) + render 동기화 + HTML 복사/다운로드 |
| **1.5(선택)** | 섹션 이미지 AI 편집(`onSectionImageAiEdit` + `AiEditModal context="detail"`) |
| **2** | 에셋 라이브러리 — 이커머스 SVG 아이콘 검색/삽입. `DetailPageEditor`의 `SectionCard` 편집 흐름에 통합(별도 설계 문서 필요) |

---

## 15. 구현 시 반드시 지킬 검증 포인트 (코드 대조 결과)

1. **upload-image 필드명**: `file`, `usageContext='listing_detail'`. 응답은 `json.data.url`(중첩). `Content-Type` 수동 설정 금지.
2. **generate-detail-html**: `imageUrls`(URL 배열) 사용. 응답 `json.success`/`json.html`/`json.content` 확인. `content`는 신규 생성 모드에서만 옴.
3. **contentToSections**: headline/ctaText 빈 값이면 throw → try/catch 필수.
4. **edit-section** 응답은 `{ section, html }`(에러는 `{ error }`), palette 9종 허용. 전체 미리보기는 render 재호출로 갱신.
5. **render** palette enum **5종만** + hex `#RRGGBB` 6자리 정규식 → 9종 팔레트/3자리 hex 거부 가능. fallback 처리.
6. **DetailPageEditor**: `onSectionAiEdit` 필수, `hidePreview` 기본 false(내장 미리보기 사용), `height:100%`라 부모 높이 필요.
7. **layout 중복 금지**: `listing/layout.tsx`가 이미 AppShell 제공 → 페이지에서 재래핑 금지.
8. **AppShell NavChild**: `{ href, label, icon }` 3필드 필수. `/listing` children에 `/listing/detail-maker` 추가.
9. **store 비오염**: detail-maker는 로컬 state 사용(useListingStore.assetsDraft 미사용) — 독립 페이지.
10. **MEMORY**: input에 명시적 `text-gray-900` / 인라인 dark color 지정.

---

## 16. 미결정 / 결정 필요 항목

- **ThemeBar 팔레트 노출 범위**: 9종 전부 노출 시 render API(5종)와 충돌. (a) ThemeBar에 render 호환 5종만 노출하도록 옵션 prop 추가, (b) render API enum을 9종으로 확장, (c) §10.1 fallback만으로 감수. — 본 스펙 권장: 단기 (c), 중기 (b)로 render enum을 edit-section과 통일.
- **brandName 활용**: Phase 1 미전달. 향후 `productSpecs`/`conversationContext`로 연결 시 generate-detail-html 계약 활용.
