# Assets 탭 4가지 버그 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 썸네일/상세 만들기 탭에서 발생하는 4가지 버그(이미지 미반영 · 소스 버튼 미표시(이미 수정) · 개별 저장 없음 · NOTICE 세로 배치)를 수정한다.

**Architecture:** 3개 파일 수정. (1) `detail-page-privacy.ts` — PRIVACY_FOOTER_HTML flex 변환. (2) `AssetsTab.tsx` — contentToSections 후 detailFiles를 첫 섹션 attachedImages에 자동 할당. (3) `AssetsInputPanel.tsx` — 이미지 슬롯에 다운로드(↓) 버튼 추가.

**Tech Stack:** Next.js 15, React, Zustand, Vitest, React Testing Library

---

## 파일 구조

| 파일 | 역할 | 작업 |
|------|------|------|
| `src/lib/detail-page-privacy.ts` | NOTICE/RETURN/PRIVACY HTML 생성 | 수정 |
| `src/components/listing/assets/AssetsTab.tsx` | 자동 생성 핸들러 | 수정 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 이미지 업로드 슬롯 UI | 수정 |
| `src/__tests__/lib/detail-page-privacy.test.ts` | privacy footer 테스트 | 신규 |
| `src/__tests__/components/assets-tab.test.tsx` | AssetsTab 이미지 연결 테스트 | 추가 |
| `src/__tests__/components/assets-input-panel.test.tsx` | 다운로드 버튼 테스트 | 추가 |

---

## Task 1: NOTICE/RETURN/PRIVACY 가로 배치 (detail-page-privacy.ts)

**Files:**
- Modify: `src/lib/detail-page-privacy.ts`
- Test: `src/__tests__/lib/detail-page-privacy.test.ts` (신규)

- [ ] **Step 1-1: 실패 테스트 작성**

파일 생성: `src/__tests__/lib/detail-page-privacy.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { PRIVACY_FOOTER_HTML, appendPrivacyFooter } from '@/lib/detail-page-privacy';

describe('PRIVACY_FOOTER_HTML', () => {
  it('3개 이미지가 flex 컨테이너 안에 가로로 배치된다', () => {
    expect(PRIVACY_FOOTER_HTML).toContain('display:flex');
    expect(PRIVACY_FOOTER_HTML).toContain('flex:1');
    // 3개 이미지가 모두 포함되어야 한다
    expect(PRIVACY_FOOTER_HTML).toContain('frame-03-custom_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-01-custom_return_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-02-custom_privacy.jpg');
  });

  it('3개의 개별 max-width 래퍼가 아니라 하나의 flex 컨테이너다', () => {
    // 이전 구현: 3개의 독립 div가 세로 스택
    // 새 구현: 하나의 flex 컨테이너 안에 3개 자식
    const divCount = (PRIVACY_FOOTER_HTML.match(/<div/g) ?? []).length;
    // 부모 1개 + 자식 3개 = 4개
    expect(divCount).toBe(4);
  });

  it('appendPrivacyFooter가 flex HTML을 올바르게 추가한다', () => {
    const result = appendPrivacyFooter('<div>상품 설명</div>');
    expect(result).toContain('display:flex');
    expect(result).toContain('상품 설명');
  });

  it('이미 footer가 있으면 중복 삽입하지 않는다', () => {
    const withFooter = appendPrivacyFooter('');
    const result = appendPrivacyFooter(withFooter);
    const count = (result.match(/frame-03-custom_notice/g) ?? []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 1-2: 테스트가 실패하는지 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/lib/detail-page-privacy.test.ts
```

Expected: `3개 이미지가 flex 컨테이너 안에 가로로 배치된다` 실패 (display:flex 없음)

- [ ] **Step 1-3: detail-page-privacy.ts 수정**

파일: `src/lib/detail-page-privacy.ts` 전체 교체

```typescript
/**
 * 상세페이지 하단 고정 이미지 3종
 * 모든 상품 상세페이지 끝에 반드시 포함 (법적 요건 + 고객 안내).
 *
 * 순서: Notice(주문/배송) → Return(반품/CS) → Privacy(개인정보)
 */

const FIXED_IMAGES = [
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-03-custom_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-01-custom_return_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-02-custom_privacy.jpg',
] as const;

export const PRIVACY_FOOTER_HTML =
  `<div style="max-width:780px;margin:0 auto;display:flex;gap:0;line-height:0;">` +
  FIXED_IMAGES.map(
    (src) =>
      `<div style="flex:1;min-width:0;"><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
  ).join('') +
  `</div>`;

/**
 * 기존 HTML 끝에 고정 이미지 3종을 붙인다.
 * 이미 포함돼 있으면 중복 삽입하지 않는다.
 */
export function appendPrivacyFooter(html: string): string {
  if (!html) return PRIVACY_FOOTER_HTML;
  if (html.includes(FIXED_IMAGES[0])) return html;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${PRIVACY_FOOTER_HTML}\n</body>`);
  }
  return html + '\n' + PRIVACY_FOOTER_HTML;
}
```

- [ ] **Step 1-4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-privacy.test.ts
```

Expected: 4개 테스트 모두 PASS

- [ ] **Step 1-5: 커밋**

```bash
git add src/lib/detail-page-privacy.ts src/__tests__/lib/detail-page-privacy.test.ts
git commit -m "fix: NOTICE/RETURN/PRIVACY 3개 이미지 세로→가로(flex) 배치"
```

---

## Task 2: 상세페이지용 이미지 → 첫 번째 섹션 attachedImages 자동 연결 (AssetsTab.tsx)

**Files:**
- Modify: `src/components/listing/assets/AssetsTab.tsx`
- Test: `src/__tests__/components/assets-tab.test.tsx` (기존 파일에 테스트 추가)

- [ ] **Step 2-1: 실패 테스트 추가**

`src/__tests__/components/assets-tab.test.tsx` 파일 끝에 아래 `describe` 블록을 추가한다.
(기존 import, server, generateSpy, describe('AssetsTab') 블록은 그대로 유지)

```typescript
describe('AssetsTab — 업로드 모드 이미지 섹션 자동 연결', () => {
  beforeEach(() => {
    generateSpy.mockReset();
    useListingStore.getState().resetAssetsDraft();
  });

  it('업로드 모드에서 자동 생성 후 첫 번째 섹션의 attachedImages에 detailFiles가 연결된다', async () => {
    const mockContent = {
      headline: '테스트',
      subheadline: '서브',
      sellingPoints: [{ icon: '✨', title: '장점', description: '설명' }],
      features: [{ title: '특징', description: '설명' }],
      specs: [],
      usageSteps: ['사용법'],
      warnings: [],
      ctaText: '구매하기',
    };

    server.use(
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({
          html: '<div>상세페이지</div>',
          content: mockContent,
        }),
      ),
    );

    const store = useListingStore.getState();
    store.updateAssetsDraft({
      mode: 'upload',
      detailFiles: ['https://example.com/detail1.jpg', 'https://example.com/detail2.jpg'],
      thumbnailFiles: ['https://example.com/thumb.jpg'],
    });

    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      const sections = useListingStore.getState().assetsDraft.detailPageSections;
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0].attachedImages).toHaveLength(2);
      expect(sections[0].attachedImages[0].url).toBe('https://example.com/detail1.jpg');
      expect(sections[0].attachedImages[1].url).toBe('https://example.com/detail2.jpg');
      expect(sections[0].attachedImages[0].processingMode).toBe('original');
    });
  });

  it('detailFiles가 없으면 thumbnailFiles를 첫 번째 섹션에 연결한다', async () => {
    const mockContent = {
      headline: '테스트',
      subheadline: '서브',
      sellingPoints: [{ icon: '✨', title: '장점', description: '설명' }],
      features: [{ title: '특징', description: '설명' }],
      specs: [],
      usageSteps: ['사용법'],
      warnings: [],
      ctaText: '구매하기',
    };

    server.use(
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({ html: '<div></div>', content: mockContent }),
      ),
    );

    const store = useListingStore.getState();
    store.updateAssetsDraft({
      mode: 'upload',
      detailFiles: [],
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
    });

    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      const sections = useListingStore.getState().assetsDraft.detailPageSections;
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0].attachedImages[0].url).toBe('https://example.com/thumb1.jpg');
    });
  });
});
```

- [ ] **Step 2-2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/components/assets-tab.test.tsx
```

Expected: `첫 번째 섹션의 attachedImages에 detailFiles가 연결된다` FAIL (attachedImages 비어 있음)

- [ ] **Step 2-3: AssetsTab.tsx 수정**

`src/components/listing/assets/AssetsTab.tsx`에서 업로드 모드 분기(라인 102~135)를 아래처럼 수정한다.
`contentToSections` 호출 직후 섹션에 이미지를 할당하는 로직을 추가한다.

```typescript
      // ── 업로드 모드 ─────────────────────────────────────────────────────────
      const thumbnails = [...assetsDraft.thumbnailFiles];
      const detailSources = assetsDraft.detailFiles.length > 0
        ? [...assetsDraft.detailFiles]
        : [...assetsDraft.thumbnailFiles];

      let detailHtml = '';
      let detailContent: DetailPageContent | undefined;
      if (detailSources.length > 0) {
        updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
        const result = await generateDetailHtml(detailSources);
        detailHtml = result.html;
        detailContent = result.content;
      }

      let detailPageSections = assetsDraft.detailPageSections;
      if (detailContent) {
        try {
          detailPageSections = contentToSections(detailContent);
          // 첫 번째 섹션에 업로드 이미지를 자동 연결한다.
          // 사용자는 이후 소스 픽커로 섹션별 이미지를 교체/추가할 수 있다.
          if (detailPageSections.length > 0 && detailSources.length > 0) {
            detailPageSections = detailPageSections.map((s, idx) =>
              idx === 0
                ? {
                    ...s,
                    attachedImages: detailSources.map((url, order) => ({
                      url,
                      order,
                      processingMode: 'original' as const,
                    })),
                  }
                : s,
            );
          }
        } catch {
          // 파싱 실패 시 silent fallback
        }
      }

      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedThumbnails: thumbnails,
        generatedDetailHtml: detailHtml,
        detailPageSections,
      });
```

> URL 모드(라인 82~90)에도 동일한 이미지 연결 패턴을 적용한다.
> `thumbnails`(generatedThumbnails)을 사용해 첫 번째 섹션에 할당한다.

URL 모드 `contentToSections` 호출 직후도 같은 방식으로 수정:

```typescript
        if (detailContent) {
          try {
            detailPageSections = contentToSections(detailContent);
            if (detailPageSections.length > 0 && thumbnails.length > 0) {
              detailPageSections = detailPageSections.map((s, idx) =>
                idx === 0
                  ? {
                      ...s,
                      attachedImages: thumbnails.map((url, order) => ({
                        url,
                        order,
                        processingMode: 'original' as const,
                      })),
                    }
                  : s,
              );
            }
          } catch {
            // 파싱 실패 시 silent fallback
          }
        }
```

- [ ] **Step 2-4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/assets-tab.test.tsx
```

Expected: 모든 테스트 PASS

- [ ] **Step 2-5: 커밋**

```bash
git add src/components/listing/assets/AssetsTab.tsx src/__tests__/components/assets-tab.test.tsx
git commit -m "fix: 자동 생성 후 detailFiles를 첫 번째 섹션 attachedImages에 자동 연결"
```

---

## Task 3: 업로드 슬롯 이미지에 다운로드 버튼 추가 (AssetsInputPanel.tsx)

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`
- Test: `src/__tests__/components/assets-input-panel.test.tsx` (기존 파일에 테스트 추가)

- [ ] **Step 3-1: 실패 테스트 추가**

`src/__tests__/components/assets-input-panel.test.tsx` 파일 끝에 추가:

```typescript
describe('AssetsInputPanel — 이미지 슬롯 다운로드 버튼', () => {
  it('업로드된 상세페이지 이미지마다 다운로드 버튼이 렌더된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      detailFiles: [
        'https://example.com/detail1.jpg',
        'https://example.com/detail2.jpg',
      ],
    });

    render(<AssetsInputPanel onGenerate={() => {}} />);

    const downloadBtns = screen.getAllByRole('button', { name: /이미지 저장/ });
    expect(downloadBtns).toHaveLength(2);
  });

  it('업로드된 썸네일 이미지마다 다운로드 버튼이 렌더된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
    });

    render(<AssetsInputPanel onGenerate={() => {}} />);

    const downloadBtns = screen.getAllByRole('button', { name: /이미지 저장/ });
    expect(downloadBtns).toHaveLength(1);
  });
});
```

- [ ] **Step 3-2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx
```

Expected: `이미지 슬롯 다운로드 버튼` FAIL (버튼 미존재)

- [ ] **Step 3-3: AssetsInputPanel.tsx 수정**

`src/components/listing/assets/AssetsInputPanel.tsx`에서 두 가지를 수정한다.

**① 컴포넌트 스코프(함수 본문 최상단)에 `handleDownloadSlotImage` 헬퍼 추가:**

`const renderSlot = ...` 선언 바로 앞에 추가:

```typescript
  const handleDownloadSlotImage = async (url: string, index: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `image-${index + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, '_blank');
    }
  };
```

**② `renderSlot` 내부의 이미지 카드에 `↓` 버튼 추가:**

기존 `🔗` URL 복사 버튼(bottom: 2, right: 2) 코드 바로 앞에 아래 버튼을 삽입한다:

```typescript
              {/* 다운로드 버튼 — 🔗 버튼 왼쪽 */}
              <button
                type="button"
                title="이미지 저장"
                aria-label="이미지 저장"
                onClick={() => void handleDownloadSlotImage(u, i)}
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 22,
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: 'none',
                  borderRadius: 3,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontSize: 9,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ↓
              </button>
```

삽입 위치: `renderSlot` 안의 `{files.map((u, i) => (` 블록, 기존 URL 복사 버튼(`title="URL 복사"`) 바로 앞.

- [ ] **Step 3-4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx
```

Expected: 모든 테스트 PASS

- [ ] **Step 3-5: 전체 테스트 회귀 확인**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 기존 테스트 포함 전체 PASS (또는 이 PR 외 기존 실패는 제외)

- [ ] **Step 3-6: 커밋**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx src/__tests__/components/assets-input-panel.test.tsx
git commit -m "feat: 업로드 이미지 슬롯에 개별 다운로드(↓) 버튼 추가"
```

---

## Task 4: 최종 검증 및 푸시

- [ ] **Step 4-1: 전체 테스트 수트 실행**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: 새로 추가한 테스트 포함 전체 PASS

- [ ] **Step 4-2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: 프로젝트 코드에서 새로운 타입 오류 없음

- [ ] **Step 4-3: 원격 저장소 푸시**

```bash
git push origin main
```

---

## 이슈 2 — 소스 버튼 미표시 (이미 완료)

`SectionImageAttachment.tsx`에 `assetsDraft.thumbnailFiles`, `assetsDraft.detailFiles`,
`assetsDraft.generatedThumbnails`를 `sourceImages`에 포함하도록 수정 완료.
(commit `6e0bfcf`, 2026-05-25) — 별도 작업 불필요.
