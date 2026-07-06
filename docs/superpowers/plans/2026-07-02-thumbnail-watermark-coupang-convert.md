# 썸네일 WM 제거 + 쿠팡 변환 다운로드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 썸네일 참조 이미지에 워터마크 제거 버튼과 쿠팡 규격(1200×1200) 변환·다운로드 기능을 추가한다.

**Architecture:** `enforceCoupangPolicy` Sharp 로직을 공유 유틸로 추출하고, 새 API `/api/image/coupang-convert`를 만들어 binary JPEG를 반환한다. `DetailMakerThumbnailPanel`에 WM 버튼과 쿠팡 변환 버튼+미리보기 모달을 인라인으로 추가한다.

**Tech Stack:** Sharp (이미지 처리), Next.js App Router API Route, React useState

---

## 파일 목록

| 파일 | 변경 유형 |
|------|----------|
| `src/lib/image/coupang-policy.ts` | 신규 생성 — `enforceCoupangPolicy` 유틸 |
| `src/app/api/image/coupang-convert/route.ts` | 신규 생성 — 변환 API |
| `src/app/api/ai/edit-thumbnail/route.ts` | 수정 — 로컬 함수 → 공유 유틸 import |
| `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` | 수정 — WM 버튼 + 쿠팡 버튼 + 미리보기 모달 |

---

### Task 1: 공유 유틸 `coupang-policy.ts` 생성

**Files:**
- Create: `src/lib/image/coupang-policy.ts`

- [ ] **Step 1: 파일 생성**

`src/lib/image/coupang-policy.ts`를 아래 내용으로 생성한다.

```typescript
import sharp from 'sharp';

const CANVAS_SIZE = 1200;
const FILL_RATIO = 0.92;
const TRIM_THRESHOLD = 12;

/**
 * 쿠팡 정책을 강제하는 결정적 후처리:
 * 1) 흰 배경 trim → 상품 윤곽 추출
 * 2) 1200×1200 흰 캔버스 중앙에 92% 크기로 재배치
 * 3) JPEG q92 인코딩
 *
 * trim 실패 시(배경이 흰색이 아닌 경우) 원본 buffer 그대로 반환.
 */
export async function enforceCoupangPolicy(
  inputBuffer: Buffer,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const trimmed = await sharp(inputBuffer)
      .trim({
        background: { r: 255, g: 255, b: 255 },
        threshold: TRIM_THRESHOLD,
      })
      .toBuffer();

    const meta = await sharp(trimmed).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
      return { buffer: inputBuffer, mimeType: 'image/jpeg' };
    }

    const longEdge = Math.max(w, h);
    const targetLongEdge = Math.round(CANVAS_SIZE * FILL_RATIO);
    const scale = targetLongEdge / longEdge;
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));

    const resized = await sharp(trimmed)
      .resize(newW, newH, { fit: 'fill' })
      .toBuffer();

    const result = await sharp({
      create: {
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: resized, gravity: 'center' }])
      .jpeg({ quality: 92, progressive: true })
      .toBuffer();

    return { buffer: result, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn(
      '[coupang-policy] enforceCoupangPolicy 실패, 원본 유지:',
      err instanceof Error ? err.message : err,
    );
    return { buffer: inputBuffer, mimeType: 'image/jpeg' };
  }
}
```

- [ ] **Step 2: `edit-thumbnail/route.ts`에서 로컬 함수 교체**

`src/app/api/ai/edit-thumbnail/route.ts` 상단 import에 추가한다.

```typescript
import { enforceCoupangPolicy } from '@/lib/image/coupang-policy';
```

그런 다음 `route.ts` 내부의 기존 `enforceCoupangPolicy` 함수 전체(63~111줄, `async function enforceCoupangPolicy(...)`)를 삭제한다. 상수 `POSTPROCESS_CANVAS_SIZE`, `POSTPROCESS_FILL_RATIO`, `POSTPROCESS_TRIM_THRESHOLD`도 함께 삭제한다.

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -30
```

오류 없으면 다음 단계로.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/image/coupang-policy.ts src/app/api/ai/edit-thumbnail/route.ts
git commit -m "refactor(image): enforceCoupangPolicy를 공유 유틸로 추출"
```

---

### Task 2: `/api/image/coupang-convert` API 라우트 생성

**Files:**
- Create: `src/app/api/image/coupang-convert/route.ts`

- [ ] **Step 1: 라우트 파일 생성**

`src/app/api/image/coupang-convert/route.ts`를 아래 내용으로 생성한다.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { enforceCoupangPolicy } from '@/lib/image/coupang-policy';

const DOWNLOAD_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  let imageUrl: string;
  try {
    const body = await req.json() as { imageUrl?: unknown };
    if (typeof body.imageUrl !== 'string' || !body.imageUrl.startsWith('http')) {
      return NextResponse.json({ error: 'imageUrl이 필요합니다.' }, { status: 400 });
    }
    imageUrl = body.imageUrl;
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  // 이미지 다운로드
  let inputBuffer: Buffer;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({ error: `이미지 다운로드 실패 (${res.status})` }, { status: 502 });
    }
    inputBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '이미지 다운로드 중 오류';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 쿠팡 정책 변환
  const { buffer } = await enforceCoupangPolicy(inputBuffer);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="thumbnail-coupang.jpg"',
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/image/coupang-convert/route.ts
git commit -m "feat(api): /api/image/coupang-convert — 쿠팡 규격 변환 엔드포인트 추가"
```

---

### Task 3: `DetailMakerThumbnailPanel` UI 수정

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx`

현재 파일에서 변경할 것:
1. `watermarkExtraIdx` state 추가 (WM 모달용)
2. `coupangConvertIdx` state 추가 (로딩 인디케이터용)
3. `coupangPreview` state 추가 (`{ idx: number; blobUrl: string } | null`)
4. 이미지 카드에 "WM" 버튼 + `ImageCleanupModal mode="watermark"` 추가
5. 이미지 카드에 "쿠팡" 버튼 + 변환 핸들러 추가
6. 미리보기 모달 추가 (포털 없이 fixed 오버레이)

- [ ] **Step 1: state 3개 추가**

`DetailMakerThumbnailPanel.tsx`의 `const [cleanupExtraIdx, setCleanupExtraIdx] = useState<number | null>(null);` 바로 아래에 추가:

```typescript
const [watermarkExtraIdx, setWatermarkExtraIdx] = useState<number | null>(null);
const [coupangConvertIdx, setCoupangConvertIdx] = useState<number | null>(null);
const [coupangPreview, setCoupangPreview] = useState<{ idx: number; blobUrl: string } | null>(null);
```

- [ ] **Step 2: 쿠팡 변환 핸들러 추가**

`handleGenerate` 함수 아래에 추가:

```typescript
async function handleCoupangConvert(url: string, idx: number) {
  setCoupangConvertIdx(idx);
  try {
    const res = await fetch('/api/image/coupang-convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '변환 실패' })) as { error?: string };
      alert(err.error ?? '쿠팡 변환에 실패했습니다.');
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    setCoupangPreview({ idx, blobUrl });
  } catch {
    alert('쿠팡 변환 중 오류가 발생했습니다.');
  } finally {
    setCoupangConvertIdx(null);
  }
}
```

- [ ] **Step 3: 이미지 카드 버튼 교체**

현재 이미지 카드의 "한자" 버튼 블록(`<button onClick={() => setCleanupExtraIdx(idx)} ...>한자</button>` + `{cleanupExtraIdx === idx && <ImageCleanupModal .../>}`)을 아래로 교체한다:

```tsx
{/* 하단 버튼 행 1: 한자 | WM */}
<div
  style={{
    position: 'absolute',
    bottom: 2,
    left: 2,
    right: 2,
    display: 'flex',
    gap: 2,
  }}
>
  <button
    onClick={() => setCleanupExtraIdx(idx)}
    aria-label="한자 제거"
    style={{
      flex: 1,
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      fontSize: '10px',
      padding: '2px 0',
      cursor: 'pointer',
      lineHeight: 1,
    }}
  >
    한자
  </button>
  <button
    onClick={() => setWatermarkExtraIdx(idx)}
    aria-label="워터마크 제거"
    style={{
      flex: 1,
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      fontSize: '10px',
      padding: '2px 0',
      cursor: 'pointer',
      lineHeight: 1,
    }}
  >
    WM
  </button>
</div>

{/* 쿠팡 변환 버튼 */}
<button
  onClick={() => handleCoupangConvert(url, idx)}
  disabled={coupangConvertIdx === idx}
  aria-label="쿠팡 규격 변환"
  style={{
    position: 'absolute',
    top: 2,
    left: 2,
    background: coupangConvertIdx === idx ? 'rgba(0,0,0,0.4)' : 'rgba(190,0,20,0.85)',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '9px',
    padding: '2px 4px',
    cursor: coupangConvertIdx === idx ? 'wait' : 'pointer',
    lineHeight: 1,
    fontWeight: 700,
  }}
>
  {coupangConvertIdx === idx ? '...' : '쿠팡'}
</button>

{/* 한자 모달 */}
{cleanupExtraIdx === idx && (
  <ImageCleanupModal
    imageUrl={url}
    onReplace={newUrl => {
      onReplaceExtraRef?.(idx, newUrl);
      setCleanupExtraIdx(null);
    }}
    onAdd={newUrl => {
      onAddExtraRef?.(newUrl);
      setCleanupExtraIdx(null);
    }}
    onClose={() => setCleanupExtraIdx(null)}
    canAdd={true}
  />
)}

{/* WM 모달 */}
{watermarkExtraIdx === idx && (
  <ImageCleanupModal
    imageUrl={url}
    mode="watermark"
    onReplace={newUrl => {
      onReplaceExtraRef?.(idx, newUrl);
      setWatermarkExtraIdx(null);
    }}
    onAdd={newUrl => {
      onAddExtraRef?.(newUrl);
      setWatermarkExtraIdx(null);
    }}
    onClose={() => setWatermarkExtraIdx(null)}
    canAdd={true}
  />
)}
```

- [ ] **Step 4: 미리보기 모달 추가**

`</div>` (컴포넌트 최하단 return 닫기 전, `<style>` 태그 바로 위)에 추가:

```tsx
{/* 쿠팡 변환 미리보기 모달 */}
{coupangPreview && (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
    onClick={() => {
      URL.revokeObjectURL(coupangPreview.blobUrl);
      setCoupangPreview(null);
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: 20,
        maxWidth: 320,
        width: '90vw',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>쿠팡 썸네일 변환 결과</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          1200 × 1200px · 흰 배경 · 상품 92% fill
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={coupangPreview.blobUrl}
        alt="쿠팡 변환 결과"
        style={{
          width: '100%',
          aspectRatio: '1',
          objectFit: 'contain',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <a
          href={coupangPreview.blobUrl}
          download="thumbnail-coupang.jpg"
          style={{ flex: 1, textDecoration: 'none' }}
        >
          <button
            style={{
              width: '100%',
              padding: '8px 0',
              background: '#be0014',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            다운로드
          </button>
        </a>
        <button
          onClick={() => {
            URL.revokeObjectURL(coupangPreview.blobUrl);
            setCoupangPreview(null);
          }}
          style={{
            flex: 1,
            padding: '8px 0',
            background: '#f3f4f6',
            color: '#374151',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          닫기
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx
git commit -m "feat(thumbnail): WM 제거 버튼 + 쿠팡 변환 미리보기·다운로드 추가"
```

---

## 검증 체크리스트

- [ ] 썸네일 탭에서 참조 이미지 업로드 후 이미지 카드에 "WM", "쿠팡" 버튼 표시 확인
- [ ] "WM" 버튼 클릭 → ImageCleanupModal 열림, 영역 선택 후 워터마크 제거 동작 확인
- [ ] "쿠팡" 버튼 클릭 → 로딩("...") 표시 → 완료 후 미리보기 모달 열림 확인
- [ ] 미리보기 이미지 확인 후 "다운로드" 클릭 → `thumbnail-coupang.jpg` 파일 저장 확인
- [ ] 기존 AI 썸네일 생성 (`AI 썸네일 생성` 버튼) 회귀 없음 확인
