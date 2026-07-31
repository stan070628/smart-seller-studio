# 유튜브 영상 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지에 유튜브 영상 섹션을 추가한다 — 에디터 미리보기에서는 실제 iframe으로 재생하고, 쿠팡/스마트스토어 붙여넣기용 내보내기 HTML에는 재생버튼이 합성된 썸네일 이미지(Supabase 호스팅) + 링크를 넣는다. 섹션별 표시/숨김 토글로 on/off 하며, 기존 드래프트 자동저장으로 나중에 추가·업데이트 가능하다.

**Architecture:** 신규 최상위 `SectionType: 'youtube'`. 미리보기·내보내기 HTML은 모두 `/api/detail-page/render`에서 나오므로 여기에 `mode: 'preview' | 'export'`를 추가한다. `renderSection`은 동기 함수라 썸네일 합성(fetch+Sharp+업로드)은 **render route에서 async로 선처리**해 `content.exportThumbnailUrl`에 채운 뒤, 동기 `renderYoutube`는 그 URL만 사용한다. 에디터는 `ClaudeLayoutEditor` 패턴을 따라 `YoutubeEditor`를 `onSectionUpdate(id, updates)`로 편집한다. 저장은 기존 `detail_page_drafts` 인프라가 제네릭이라 그대로 영속화된다.

**Tech Stack:** Next.js(App Router), TypeScript, Zod, Sharp, Supabase Storage(`uploadToStorage`), vitest, dnd-kit(기존 순서변경).

> **환경 주의:** 인자 없는 `npx vitest run`은 라이브러리 테스트까지 돌며 worker 타임아웃으로 죽을 수 있다. 반드시 **경로 지정**(`npx vitest run <path>`)으로 실행한다. 타임아웃 시 동일 assertion을 `tsx` 하니스(`_tdd_*.ts`)로 구동해 RED/GREEN 관찰 후 하니스 삭제.

> **스펙:** `docs/superpowers/specs/2026-07-19-youtube-video-section-design.md`

---

## File Structure

| 파일 | 책임 | 액션 |
|---|---|---|
| `src/types/detail-page.ts` | `YoutubeContent` 타입 + `SectionType`/`SectionContent` 유니온 + `isYoutubeContent` 가드 | Modify |
| `src/lib/detail-page/youtube.ts` | `parseYoutubeUrl` 순수 함수 (URL→{videoId, aspect}) | Create |
| `src/lib/detail-page/youtube-thumbnail.ts` | `composeYoutubeThumbnail` (썸네일 fetch + Sharp 재생버튼 합성 + Supabase 업로드) | Create |
| `src/lib/detail-page/section-parser.ts` | `createEmptySection`에 `youtube` 케이스 | Modify |
| `src/lib/detail-page/section-renderer.ts` | `renderYoutube` + `renderSection`/`renderAllSections`에 `mode` 스레딩 + switch case | Modify |
| `src/app/api/detail-page/render/route.ts` | zod enum에 `youtube`, `mode` 파라미터, 유튜브 썸네일 async 선처리 | Modify |
| `src/components/listing/detail-editor/YoutubeEditor.tsx` | 유튜브 섹션 편집 폼(URL·비율·캡션·표시토글) | Create |
| `src/components/listing/detail-editor/SectionCard.tsx` | `SECTION_TYPE_LABELS`/`getSectionSummary`에 youtube, `YoutubeEditor` 결선, `onSectionUpdate` 타입 확장 | Modify |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | `ADD_SECTION_OPTIONS`에 유튜브, `handleSectionUpdate` 타입 확장 | Modify |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 미리보기 render `mode:'preview'`, 복사/다운로드 export 재렌더 | Modify |
| `src/__tests__/lib/detail-page/youtube.test.ts` | URL 파서 테스트 | Create |
| `src/__tests__/lib/detail-page/youtube-thumbnail.test.ts` | 합성 유틸 테스트(네트워크/업로드 목) | Create |
| `src/__tests__/lib/detail-page/section-renderer-youtube.test.ts` | `renderYoutube` mode별 테스트 | Create |
| `src/__tests__/lib/detail-page/section-parser.test.ts` | `createEmptySection('youtube')` 테스트 | Modify(or Create) |

---

## WS1 — 타입 + URL 파서

### Task 1: YoutubeContent 타입 정의

**Files:**
- Modify: `src/types/detail-page.ts`

- [ ] **Step 1: `SectionType` 유니온에 `'youtube'` 추가**

`src/types/detail-page.ts:3-21` 유니온 마지막(`| 'claude_layout';` 앞)에 추가:
```typescript
  | 'claude_layout'
  | 'youtube';
```

- [ ] **Step 2: `YoutubeContent` 인터페이스 추가**

`ClaudeLayoutContent` 인터페이스(약 :183-190) 다음에 추가:
```typescript
export interface YoutubeContent {
  type: 'youtube';
  url: string;                          // 붙여넣은 원본 URL
  videoId: string;                      // 파싱된 11자 ID
  aspect: 'vertical' | 'horizontal';    // Shorts=9:16, 일반=16:9
  caption?: string;                     // 예: "동영상제공:유투버varoachi"
  enabled: boolean;                     // 표시/숨김 토글
  exportThumbnailUrl?: string;          // export 렌더 직전 route가 채우는 합성 썸네일 호스팅 URL
}
```

- [ ] **Step 3: `SectionContent` 유니온에 추가**

`SectionContent` 유니온(약 :192-210) 마지막에 `| YoutubeContent` 추가:
```typescript
  | ClaudeLayoutContent
  | YoutubeContent;
```

- [ ] **Step 4: 타입 가드 추가**

타입 가드 헬퍼 영역(약 :239~, `isHeroContent` 등 근처)에 추가:
```typescript
export function isYoutubeContent(c: SectionContent): c is YoutubeContent {
  return c.type === 'youtube';
}
```

- [ ] **Step 5: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: `SECTION_TYPE_LABELS`(Record<SectionType>)·`createEmptySection`·`renderSection` 등에서 `youtube` 누락 에러가 발생한다 — 이 에러들은 이후 Task에서 해소된다. (이 시점에선 에러가 나는 게 정상.)

- [ ] **Step 6: Commit**

```bash
git add src/types/detail-page.ts
git commit -m "feat(detail-page): YoutubeContent 타입 추가"
```

---

### Task 2: parseYoutubeUrl 순수 함수

**Files:**
- Create: `src/lib/detail-page/youtube.ts`
- Test: `src/__tests__/lib/detail-page/youtube.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/detail-page/youtube.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseYoutubeUrl } from '@/lib/detail-page/youtube';

describe('parseYoutubeUrl', () => {
  it('youtu.be 단축 URL → 가로', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('watch?v= URL → 가로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('shorts URL → 세로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'vertical' });
  });
  it('embed URL → 가로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('유효하지 않은 URL → null', () => {
    expect(parseYoutubeUrl('https://example.com/video')).toBeNull();
    expect(parseYoutubeUrl('그냥 텍스트')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/youtube.test.ts`
Expected: FAIL — `parseYoutubeUrl` 미정의.

- [ ] **Step 3: 구현**

`src/lib/detail-page/youtube.ts`:
```typescript
// 유튜브 URL 파싱 — videoId 추출 + Shorts 여부로 비율 추정
export interface ParsedYoutube {
  videoId: string;
  aspect: 'vertical' | 'horizontal';
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeUrl(raw: string): ParsedYoutube | null {
  if (!raw || typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  let videoId = '';
  let aspect: 'vertical' | 'horizontal' = 'horizontal';

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' && parts[1]) {
      videoId = parts[1];
      aspect = 'vertical';
    } else if (parts[0] === 'embed' && parts[1]) {
      videoId = parts[1];
    } else {
      videoId = url.searchParams.get('v') ?? '';
    }
  } else {
    return null;
  }

  if (!ID_RE.test(videoId)) return null;
  return { videoId, aspect };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/youtube.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/youtube.ts src/__tests__/lib/detail-page/youtube.test.ts
git commit -m "feat(detail-page): parseYoutubeUrl 유틸"
```

---

## WS2 — createEmptySection + 라벨/요약

### Task 3: createEmptySection('youtube')

**Files:**
- Modify: `src/lib/detail-page/section-parser.ts`
- Test: `src/__tests__/lib/detail-page/section-parser.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (기존 파일에 추가 또는 신규)**

`src/__tests__/lib/detail-page/section-parser.test.ts`에 추가:
```typescript
import { describe, it, expect } from 'vitest';
import { createEmptySection } from '@/lib/detail-page/section-parser';

describe('createEmptySection youtube', () => {
  it('youtube 기본값', () => {
    const s = createEmptySection('youtube', 3);
    expect(s.type).toBe('youtube');
    expect(s.order).toBe(3);
    expect(s.content).toEqual({ type: 'youtube', url: '', videoId: '', aspect: 'horizontal', enabled: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-parser.test.ts -t youtube`
Expected: FAIL — `createEmptySection`이 youtube에서 default 케이스(throw 또는 잘못된 반환).

- [ ] **Step 3: 구현**

`src/lib/detail-page/section-parser.ts`의 `createEmptySection` switch(약 :403 `claude_layout` 케이스 다음)에 추가:
```typescript
    case 'youtube':
      return { ...base, type: 'youtube', content: { type: 'youtube', url: '', videoId: '', aspect: 'horizontal', enabled: true } };
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-parser.test.ts -t youtube`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/section-parser.ts src/__tests__/lib/detail-page/section-parser.test.ts
git commit -m "feat(detail-page): createEmptySection youtube 케이스"
```

---

### Task 4: 섹션 라벨 + 요약

**Files:**
- Modify: `src/components/listing/detail-editor/SectionCard.tsx`

- [ ] **Step 1: `SECTION_TYPE_LABELS`에 youtube 추가**

`SectionCard.tsx:53-72` `SECTION_TYPE_LABELS` 객체(`claude_layout: 'AI 레이아웃',` 다음)에 추가:
```typescript
  youtube: '유튜브 영상',
```

- [ ] **Step 2: `getSectionSummary`에 youtube 요약 추가**

`getSectionSummary(content)` 함수 본문에 (다른 타입 분기와 동일한 스타일로) 추가:
```typescript
  if (content.type === 'youtube') {
    return content.videoId ? `유튜브 ${content.videoId}` : '(URL 없음)';
  }
```

- [ ] **Step 3: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: `SECTION_TYPE_LABELS` youtube 누락 에러 해소. (renderSection/route 관련 에러는 아직 남아 있을 수 있음 — 이후 Task에서 해소.)

- [ ] **Step 4: Commit**

```bash
git add src/components/listing/detail-editor/SectionCard.tsx
git commit -m "feat(detail-page): 유튜브 섹션 라벨/요약"
```

---

## WS3 — 썸네일 합성 유틸

### Task 5: composeYoutubeThumbnail

**Files:**
- Create: `src/lib/detail-page/youtube-thumbnail.ts`
- Test: `src/__tests__/lib/detail-page/youtube-thumbnail.test.ts`

참고 패턴: `src/app/api/image/composite/route.ts`(Sharp composite + `uploadToStorage`), 시그니처 `uploadToStorage(path: string, buffer: ArrayBuffer, mime: string, size: number): Promise<{ url: string }>` (`src/lib/supabase/server.ts:75`).

- [ ] **Step 1: 실패 테스트 작성 (fetch/upload 목)**

`src/__tests__/lib/detail-page/youtube-thumbnail.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// uploadToStorage 목
vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(async () => ({ url: 'https://cdn.example.com/yt/thumb.jpg' })),
}));

const RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
); // 1x1 png

describe('composeYoutubeThumbnail', () => {
  beforeEach(() => {
    // maxresdefault 성공 응답 목
    global.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => RED.buffer.slice(RED.byteOffset, RED.byteOffset + RED.byteLength),
    })) as unknown as typeof fetch;
  });

  it('videoId로 썸네일을 합성해 업로드하고 호스팅 URL을 반환한다', async () => {
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    const url = await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');
    expect(url).toBe('https://cdn.example.com/yt/thumb.jpg');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('img.youtube.com/vi/dQw4w9WgXcQ/'),
      expect.anything(),
    );
  });

  it('maxres 실패 시 hqdefault로 폴백한다', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (u: string) => {
      calls.push(u);
      const ok = u.includes('hqdefault');
      return { ok, arrayBuffer: async () => RED.buffer.slice(RED.byteOffset, RED.byteOffset + RED.byteLength) };
    }) as unknown as typeof fetch;
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    const url = await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');
    expect(url).toBe('https://cdn.example.com/yt/thumb.jpg');
    expect(calls.some((c) => c.includes('maxresdefault'))).toBe(true);
    expect(calls.some((c) => c.includes('hqdefault'))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/youtube-thumbnail.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/lib/detail-page/youtube-thumbnail.ts`:
```typescript
import sharp from 'sharp';
import { uploadToStorage } from '@/lib/supabase/server';

// 중앙 재생버튼 SVG (빨간 라운드 + 흰 삼각형)
function playButtonSvg(size: number): Buffer {
  const r = Math.round(size * 0.18);
  const w = r * 2.8;
  const h = r * 2;
  const cx = w / 2;
  const cy = h / 2;
  const tri = r * 0.7;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="0" y="0" width="${w}" height="${h}" rx="${h * 0.28}" fill="#FF0033"/>
      <polygon points="${cx - tri},${cy - tri} ${cx - tri},${cy + tri} ${cx + tri * 1.3},${cy}" fill="#ffffff"/>
    </svg>`,
  );
}

async function fetchThumb(videoId: string): Promise<Buffer> {
  const candidates = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 0) return Buffer.from(ab);
      }
    } catch {
      // 다음 후보로
    }
  }
  throw new Error(`유튜브 썸네일을 가져오지 못했습니다: ${videoId}`);
}

/** 유튜브 썸네일에 재생버튼을 합성해 Supabase에 업로드하고 공개 URL을 반환한다. */
export async function composeYoutubeThumbnail(
  videoId: string,
  _aspect: 'vertical' | 'horizontal',
): Promise<string> {
  const thumb = await fetchThumb(videoId);
  const meta = await sharp(thumb).metadata();
  const width = meta.width ?? 1280;
  const overlay = await sharp(playButtonSvg(width)).png().toBuffer();

  const resultBuffer = await sharp(thumb)
    .composite([{ input: overlay, gravity: 'center' }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const arrayBuffer = resultBuffer.buffer.slice(
    resultBuffer.byteOffset,
    resultBuffer.byteOffset + resultBuffer.byteLength,
  ) as ArrayBuffer;
  const path = `ai-detail/youtube/${videoId}-${resultBuffer.byteLength}.jpg`;
  const { url } = await uploadToStorage(path, arrayBuffer, 'image/jpeg', resultBuffer.byteLength);
  return url;
}
```

> 참고: `aspect`는 현재 export 썸네일에선 사용하지 않으나(유튜브 제공 이미지를 그대로 사용), 시그니처에 유지해 향후 세로 크롭 확장 여지를 남긴다. `_aspect`로 미사용 표시.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/youtube-thumbnail.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/youtube-thumbnail.ts src/__tests__/lib/detail-page/youtube-thumbnail.test.ts
git commit -m "feat(detail-page): 유튜브 썸네일 재생버튼 합성 유틸"
```

---

## WS4 — 렌더러 + mode 스레딩

### Task 6: renderYoutube + mode 스레딩

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Test: `src/__tests__/lib/detail-page/section-renderer-youtube.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/detail-page/section-renderer-youtube.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const theme: DetailPageTheme = {
  palette: 'warm_cream', primaryColor: '#111111', accentColor: '#6366f1',
  fontStyle: 'sans', imageLayout: 'composed',
};

function ytSection(overrides: Record<string, unknown> = {}): DetailSection {
  return {
    id: 'y1', type: 'youtube', order: 0, attachedImages: [],
    content: { type: 'youtube', url: 'https://youtu.be/abc12345678', videoId: 'abc12345678', aspect: 'horizontal', enabled: true, ...overrides },
  } as DetailSection;
}

describe('renderYoutube', () => {
  it('preview 모드 → iframe embed', () => {
    const html = renderSection(ytSection(), theme, 'preview');
    expect(html).toContain('<iframe');
    expect(html).toContain('youtube.com/embed/abc12345678');
  });
  it('export 모드 → 썸네일 img + 링크 (iframe 없음)', () => {
    const html = renderSection(ytSection({ exportThumbnailUrl: 'https://cdn.example.com/t.jpg' }), theme, 'export');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('https://cdn.example.com/t.jpg');
    expect(html).toContain('href="https://youtu.be/abc12345678"');
  });
  it('enabled=false → 빈 문자열', () => {
    expect(renderSection(ytSection({ enabled: false }), theme, 'preview').trim()).toBe('');
  });
  it('videoId 없음 → 빈 문자열', () => {
    expect(renderSection(ytSection({ videoId: '' }), theme, 'preview').trim()).toBe('');
  });
  it('세로(shorts) preview → 9:16 컨테이너', () => {
    const html = renderSection(ytSection({ aspect: 'vertical' }), theme, 'preview');
    expect(html).toContain('9 / 16');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-renderer-youtube.test.ts`
Expected: FAIL — `renderSection`이 3번째 인자(mode)를 받지 않고 youtube 케이스 없음.

- [ ] **Step 3: `renderYoutube` 구현 + import**

`src/lib/detail-page/section-renderer.ts` 상단 타입 import에 `YoutubeContent` 추가. `renderClaudeLayout` 함수 근처(약 :958)에 추가:
```typescript
type RenderMode = 'preview' | 'export';

function renderYoutube(content: YoutubeContent, mode: RenderMode): string {
  if (!content.enabled || !content.videoId) return '';
  const caption = content.caption
    ? `<p style="text-align:center;font-size:12px;color:#888888;margin:8px 0 0;">${escapeHtml(content.caption)}</p>`
    : '';
  const ratio = content.aspect === 'vertical' ? '9 / 16' : '16 / 9';
  const maxW = content.aspect === 'vertical' ? '340px' : '100%';

  if (mode === 'preview') {
    return `<section style="padding:16px 0;">
      <div style="max-width:${maxW};margin:0 auto;aspect-ratio:${ratio};">
        <iframe width="100%" height="100%" style="border:0;border-radius:12px;"
          src="https://www.youtube.com/embed/${content.videoId}"
          title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>${caption}
    </section>`;
  }

  // export — 합성 썸네일 img + 링크
  const src = content.exportThumbnailUrl ?? `https://img.youtube.com/vi/${content.videoId}/hqdefault.jpg`;
  const href = content.url || `https://www.youtube.com/watch?v=${content.videoId}`;
  return `<section style="padding:16px 0;">
    <div style="max-width:${maxW};margin:0 auto;">
      <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:block;">
        <img src="${escapeHtml(src)}" alt="유튜브 영상" style="width:100%;border-radius:12px;display:block;" />
      </a>
    </div>${caption}
  </section>`;
}
```

> `escapeHtml`은 이 파일에 이미 존재하는 헬퍼를 사용한다. 만약 다른 이름이면(예: `esc`) 파일 내 기존 이스케이프 헬퍼로 맞춘다.

- [ ] **Step 4: `renderSection`/`renderAllSections`에 mode 스레딩 + switch case**

`renderSection` 시그니처(약 :976)를 변경:
```typescript
export function renderSection(section: DetailSection, theme: DetailPageTheme, mode: RenderMode = 'export'): string {
```
switch의 `claude_layout` 케이스 다음에 추가:
```typescript
    case 'youtube':
      return renderYoutube(section.content as YoutubeContent, mode);
```
`renderAllSections`(약 :1018) 변경:
```typescript
export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme, mode: RenderMode = 'export'): string {
  return [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => renderSection(s, theme, mode))
    .join('\n');
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/section-renderer-youtube.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer-youtube.test.ts
git commit -m "feat(detail-page): renderYoutube (preview iframe / export 썸네일) + mode 스레딩"
```

---

### Task 7: render route — enum + mode + 썸네일 선처리

**Files:**
- Modify: `src/app/api/detail-page/render/route.ts`

- [ ] **Step 1: zod 스키마 — youtube enum + mode 파라미터**

`RequestSchema`의 섹션 `type` enum(약 :34)에 `'youtube'` 추가:
```typescript
        type: z.enum(['hero', 'selling_points', 'features', 'stats', 'spec_table', 'usage_steps', 'warning', 'cta', 'brand_header', 'point', 'image_grid', 'claude_layout', 'youtube']),
```
`RequestSchema` 최상위(theme 다음)에 mode 추가:
```typescript
  mode: z.enum(['preview', 'export']).optional().default('export'),
```

- [ ] **Step 2: 유튜브 export 썸네일 async 선처리**

`safeSections` 산출(약 :121-125) 다음, `renderAllSections` 호출 전에 추가:
```typescript
  const { mode } = parseResult.data;

  // export 모드에서만: enabled 유튜브 섹션의 재생버튼 합성 썸네일을 미리 생성해 content에 채운다.
  const withYoutube = await Promise.all(
    safeSections.map(async (s) => {
      if (s.type !== 'youtube' || mode !== 'export') return s;
      const c = s.content as { videoId?: string; enabled?: boolean; aspect?: 'vertical' | 'horizontal' };
      if (!c.enabled || !c.videoId) return s;
      try {
        const url = await composeYoutubeThumbnail(c.videoId, c.aspect ?? 'horizontal');
        return { ...s, content: { ...c, exportThumbnailUrl: url } };
      } catch (e) {
        console.error('[detail-page/render] 유튜브 썸네일 합성 실패:', e);
        return s; // 실패 시 renderYoutube가 hqdefault 폴백 img 사용
      }
    }),
  );
```
이어서 `renderAllSections` 호출(약 :133)을 변경:
```typescript
    renderedSections = renderAllSections(withYoutube as unknown as DetailSection[], theme as DetailPageTheme, mode);
```

- [ ] **Step 3: import 추가**

파일 상단 import에 추가:
```typescript
import { composeYoutubeThumbnail } from '@/lib/detail-page/youtube-thumbnail';
```

- [ ] **Step 4: 컴파일 + 회귀 확인**

Run: `npx tsc --noEmit`
Expected: 통과 (youtube 관련 잔여 에러 없음).
Run: `npx vitest run src/__tests__/lib/detail-page/`
Expected: 기존 렌더 테스트 + 신규 youtube 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/detail-page/render/route.ts
git commit -m "feat(detail-page): render route — youtube enum + mode + 썸네일 선처리"
```

---

## WS5 — 에디터 UI + 내보내기 결선

### Task 8: YoutubeEditor 컴포넌트

**Files:**
- Create: `src/components/listing/detail-editor/YoutubeEditor.tsx`

- [ ] **Step 1: 컴포넌트 구현**

`src/components/listing/detail-editor/YoutubeEditor.tsx`:
```typescript
'use client';

import { useState } from 'react';
import type { DetailSection, YoutubeContent } from '@/types/detail-page';
import { parseYoutubeUrl } from '@/lib/detail-page/youtube';

interface Props {
  section: DetailSection;
  onUpdate: (updates: Partial<YoutubeContent>) => void;
}

export default function YoutubeEditor({ section, onUpdate }: Props) {
  const content = section.content as YoutubeContent;
  const [urlInput, setUrlInput] = useState(content.url);
  const [parseError, setParseError] = useState<string | null>(null);

  function applyUrl(value: string) {
    setUrlInput(value);
    if (!value.trim()) {
      setParseError(null);
      onUpdate({ url: '', videoId: '' });
      return;
    }
    const parsed = parseYoutubeUrl(value);
    if (!parsed) {
      setParseError('유튜브 URL을 확인해주세요.');
      onUpdate({ url: value, videoId: '' });
      return;
    }
    setParseError(null);
    onUpdate({ url: value, videoId: parsed.videoId, aspect: parsed.aspect });
  }

  const label = { fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 } as const;
  const input = { width: '100%', padding: '9px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, color: '#111', boxSizing: 'border-box' as const };

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={label}>유튜브 URL</label>
        <input style={input} value={urlInput} onChange={(e) => applyUrl(e.target.value)} placeholder="https://youtu.be/... 또는 youtube.com/shorts/..." />
        {parseError && <p style={{ color: '#e11d48', fontSize: 11, margin: '6px 0 0' }}>{parseError}</p>}
      </div>

      <div>
        <label style={label}>비율</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['horizontal', 'vertical'] as const).map((a) => (
            <button key={a} type="button" onClick={() => onUpdate({ aspect: a })}
              style={{ flex: 1, padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: content.aspect === a ? '1px solid #6366f1' : '1px solid #ddd',
                background: content.aspect === a ? '#6366f1' : '#fff', color: content.aspect === a ? '#fff' : '#555' }}>
              {a === 'horizontal' ? '가로 (일반)' : '세로 (Shorts)'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={label}>캡션 (선택)</label>
        <input style={input} value={content.caption ?? ''} onChange={(e) => onUpdate({ caption: e.target.value })} placeholder="예: 동영상제공:유투버varoachi" />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#555' }}>
        <input type="checkbox" checked={content.enabled} onChange={(e) => onUpdate({ enabled: e.target.checked })} />
        상세페이지에 표시
      </label>
    </div>
  );
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 3: Commit**

```bash
git add src/components/listing/detail-editor/YoutubeEditor.tsx
git commit -m "feat(detail-page): YoutubeEditor 편집 폼"
```

---

### Task 9: SectionCard/DetailPageEditor 결선

**Files:**
- Modify: `src/components/listing/detail-editor/SectionCard.tsx`
- Modify: `src/components/listing/detail-editor/DetailPageEditor.tsx`

- [ ] **Step 1: `onSectionUpdate` 타입 확장 (SectionCard)**

`SectionCard.tsx:49` 변경:
```typescript
  onSectionUpdate?: (id: string, updates: (Partial<import('@/types/detail-page').ClaudeLayoutContent> | Partial<import('@/types/detail-page').YoutubeContent>) & { attachedImages?: AttachedImage[] }) => void;
```

- [ ] **Step 2: YoutubeEditor 결선 (SectionCard)**

`SectionCard.tsx` 상단 import에 추가:
```typescript
import YoutubeEditor from './YoutubeEditor';
import { isYoutubeContent } from '@/types/detail-page';
```
`claude_layout` 전용 편집 UI 블록(약 :338-364) 다음에 추가:
```tsx
        {/* youtube 전용 편집 UI */}
        {isYoutubeContent(section.content) && onSectionUpdate && (
          <YoutubeEditor
            section={section}
            onUpdate={(updates) => onSectionUpdate(section.id, updates)}
          />
        )}
```

- [ ] **Step 3: `handleSectionUpdate` 타입 확장 (DetailPageEditor)**

`DetailPageEditor.tsx:335` `handleSectionUpdate`의 `updates` 타입을 SectionCard와 동일하게 확장:
```typescript
    (id: string, updates: (Partial<import('@/types/detail-page').ClaudeLayoutContent> | Partial<import('@/types/detail-page').YoutubeContent>) & { attachedImages?: AttachedImage[] }) => {
```
(본문 병합 로직 `{ ...s.content, ...contentUpdates }`은 그대로 동작.)

- [ ] **Step 4: 섹션 추가 드롭다운에 유튜브 (DetailPageEditor)**

`DetailPageEditor.tsx:165-177` `ADD_SECTION_OPTIONS` 배열 마지막에 추가:
```typescript
  { type: 'youtube',        label: '유튜브 영상' },
```

- [ ] **Step 5: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 6: Commit**

```bash
git add src/components/listing/detail-editor/SectionCard.tsx src/components/listing/detail-editor/DetailPageEditor.tsx
git commit -m "feat(detail-page): 유튜브 섹션 에디터 결선(추가 드롭다운·편집 폼)"
```

---

### Task 10: DetailMakerClient — preview/export 분리

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: 미리보기 render를 preview 모드로**

`refreshRenderedHtml`(약 :324) 내부 fetch body(약 :335)에 `mode: 'preview'` 추가:
```typescript
        body: JSON.stringify({ sections: nextSections, theme: nextTheme, mode: 'preview' }),
```
초기 즉시 미리보기 fetch(약 :92-96) body에도 `mode: 'preview'` 추가:
```typescript
            body: JSON.stringify({ sections: proSections, theme: initialTheme, mode: 'preview' }),
```

- [ ] **Step 2: 복사/다운로드를 export 재렌더로**

`getCleanHtml`(약 :1084)을 async export 렌더로 교체:
```typescript
  /** 내보내기용 HTML — export 모드로 재렌더(유튜브 썸네일 등) 후 에디터 전용 data-* 제거 */
  async function getCleanHtml(): Promise<string> {
    let html = generatedHtml;
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections, theme, mode: 'export' }),
      });
      const json = await res.json();
      if (res.ok && json.html) html = json.html;
    } catch {
      // 실패 시 현재 미리보기 HTML로 폴백
    }
    return html
      .replace(/ data-section-id="[^"]*"/g, '')
      .replace(/ data-section-type="[^"]*"/g, '')
      .replace(/ data-section-label="[^"]*"/g, '')
      .replace(/ data-edit-path="[^"]*"/g, '');
  }
```
`handleHtmlCopy`/`handleDownload`를 await로 변경:
```typescript
  async function handleHtmlCopy() {
    const html = await getCleanHtml();
    await navigator.clipboard.writeText(html).catch(() => {});
  }

  async function handleDownload() {
    const html = await getCleanHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
```

> `sections`·`theme`는 이 컴포넌트 스코프의 상태다. `getCleanHtml`이 다른 곳에서 동기로 쓰이면(호출부 확인) `await`로 맞춘다.

- [ ] **Step 3: 컴파일 + 회귀 확인**

Run: `npx tsc --noEmit`
Expected: 통과.
Run: `npx vitest run src/__tests__/lib/detail-page/ src/__tests__/api/detail-page/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-page): 미리보기=preview / 복사·다운로드=export 렌더 분리"
```

---

## 최종 검증 (수동)

- [ ] `npx tsc --noEmit` — 전체 타입 통과.
- [ ] `npx vitest run src/__tests__/lib/detail-page/` — 유닛 전부 PASS.
- [ ] 앱 구동 후 실제 플로우:
  - 에디터에서 `섹션 추가 → 유튜브 영상` → URL 붙여넣기(shorts 링크) → 비율 자동 '세로' → 미리보기에 **iframe 재생** 확인.
  - 캡션 입력 → 미리보기 하단 표시 확인.
  - **표시 토글 off** → 미리보기·복사 HTML에서 섹션 제외 확인.
  - **HTML 복사** → 복사된 소스에 `<iframe>` 없이 `<img>`(호스팅 URL) + `<a>` 링크 확인.
  - 드래프트 저장 → 새로고침/재오픈 → 유튜브 섹션(URL·비율·캡션·enabled) 복원 확인.
  - 완성 후 재오픈 → 유튜브 섹션 추가 → 재-복사 → 업데이트 확인.

---

## Self-Review 반영 메모

- 스펙 §3 URL 파싱 → Task 2. §4 에디터 UX → Task 4·8·9. §5 렌더/mode → Task 6·7. §5.2 썸네일 합성 → Task 5. §6 저장 → 기존 인프라(코드 변경은 render enum뿐, Task 7에 포함). §8 에러처리 → Task 2(파싱 null)·Task 5(fetch 폴백/throw)·Task 7(합성 실패 시 폴백).
- 타입 일관성: `YoutubeContent`(Task 1) 필드명(`videoId`·`aspect`·`enabled`·`exportThumbnailUrl`)이 Task 5·6·7·8·9에서 동일하게 사용됨. `composeYoutubeThumbnail(videoId, aspect)` 시그니처가 Task 5 정의와 Task 7 호출에서 일치.
- `escapeHtml`은 section-renderer.ts의 기존 헬퍼 사용 — 구현 시 실제 이름 확인 후 맞출 것(Task 6 Step 3 주석).
