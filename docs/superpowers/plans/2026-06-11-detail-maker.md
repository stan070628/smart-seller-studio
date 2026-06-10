# 상품상세 자동만들기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/listing/detail-maker` 페이지를 신규 생성하여, 판매자가 상품명 + 이미지 1~6장만으로 AI 상세페이지를 1분 내에 생성·편집·다운로드할 수 있도록 한다.

**Architecture:** 기존 `DetailPageEditor`, `/api/ai/generate-detail-html`, `/api/detail-page/render`, `/api/detail-page/edit-section`, `/api/listing/upload-image`를 100% 재사용. 신규 파일은 페이지 shell(`page.tsx`), 클라이언트 컨테이너(`DetailMakerClient.tsx`), 좌측 입력 패널(`DetailMakerInputPanel.tsx`), AppShell 메뉴 항목 수정만으로 구성.

**Tech Stack:** Next.js App Router, TypeScript, React `useState`, `DetailPageEditor`, `@/lib/design-tokens`, `@/lib/detail-page/palette-config`, `@/lib/detail-page/section-parser`, `@/types/detail-page`

---

## 파일 구성

| 역할 | 파일 경로 | 신규/수정 |
|------|-----------|-----------|
| 사이드바 메뉴 | `src/components/AppShell.tsx` | **수정** — L44 children 배열에 항목 추가 |
| 페이지 shell | `src/app/listing/detail-maker/page.tsx` | **신규** |
| 클라이언트 컨테이너 | `src/app/listing/detail-maker/DetailMakerClient.tsx` | **신규** |
| 좌측 입력 패널 | `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | **신규** |

> `src/app/listing/layout.tsx`는 이미 `<AppShell>{children}</AppShell>`을 제공하므로 새 `layout.tsx` 생성 금지.

---

## Task 1: AppShell 사이드바 메뉴 추가

**Files:**
- Modify: `src/components/AppShell.tsx:44-55`

- [ ] **Step 1: AppShell.tsx 읽기**

`src/components/AppShell.tsx`의 44~55번 줄을 읽어 현재 children 배열 구조를 확인한다.

- [ ] **Step 2: children 배열에 항목 추가**

`src/components/AppShell.tsx`의 `/listing` 항목 children 배열에 아래 항목을 추가한다. 기존 에디터 항목 아래에 추가:

```tsx
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

결과적으로 children 배열은:

```tsx
children: [
  {
    href: '/editor',
    label: '에디터',
    icon: (
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
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
],
```

- [ ] **Step 3: 개발 서버에서 사이드바 확인**

`npm run dev` (이미 실행 중이면 생략)로 개발 서버를 시작하고 브라우저에서 `/listing` 진입 → 사이드바에 "상품상세 자동만들기" 메뉴가 보이는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/AppShell.tsx
git commit -m "feat: 사이드바에 상품상세 자동만들기 메뉴 추가"
```

---

## Task 2: DetailMakerInputPanel 컴포넌트 생성

**Files:**
- Create: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`

- [ ] **Step 1: 디렉토리 확인**

```bash
ls src/components/listing/
```

`detail-maker/` 디렉토리가 없으면 파일 생성 시 자동으로 만들어진다.

- [ ] **Step 2: DetailMakerInputPanel.tsx 생성**

`src/components/listing/detail-maker/DetailMakerInputPanel.tsx` 파일을 생성한다:

```tsx
'use client';

import React, { useRef } from 'react';
import { C } from '@/lib/design-tokens';

type Category = 'basic' | 'fashion' | 'living' | 'food';

const CATEGORY_LABELS: Record<Category, string> = {
  basic: '기본',
  fashion: '패션',
  living: '리빙',
  food: '식품',
};

interface Props {
  productName: string;
  setProductName: (v: string) => void;
  brandName: string;
  setBrandName: (v: string) => void;
  category: Category;
  setCategory: (v: Category) => void;
  uploadedUrls: string[];
  uploading: boolean;
  isGenerating: boolean;
  error: string | null;
  onUploadFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onGenerate: () => void;
}

export default function DetailMakerInputPanel({
  productName,
  setProductName,
  brandName,
  setBrandName,
  category,
  setCategory,
  uploadedUrls,
  uploading,
  isGenerating,
  error,
  onUploadFiles,
  onRemoveImage,
  onGenerate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canGenerate = !isGenerating && productName.trim().length > 0 && uploadedUrls.length > 0;

  return (
    <div
      style={{
        width: '300px',
        minWidth: '300px',
        height: '100%',
        borderRight: `1px solid ${C.border}`,
        background: C.card,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>
          상품상세 자동만들기
        </div>
        <div style={{ fontSize: '12px', color: C.textSub, marginTop: '4px' }}>
          상품명 + 이미지로 1분 만에 상세페이지 생성
        </div>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
        {/* 상품명 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            상품명 <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={productName}
            onChange={e => setProductName(e.target.value)}
            placeholder="예) 나이키 에어맥스 런닝화 270"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: '#fff',
              color: '#111',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 카테고리 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            카테고리
          </label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  borderRadius: '20px',
                  border: category === cat ? '1.5px solid #7c3aed' : `1px solid ${C.border}`,
                  background: category === cat ? '#f5f3ff' : '#fff',
                  color: category === cat ? '#7c3aed' : C.text,
                  cursor: 'pointer',
                  fontWeight: category === cat ? 600 : 400,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* 브랜드명 (선택) */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            브랜드명 <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>(선택)</span>
          </label>
          <input
            type="text"
            value={brandName}
            onChange={e => setBrandName(e.target.value)}
            placeholder="예) 나이키"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: '#fff',
              color: '#111',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 참고 이미지 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            참고 이미지 <span style={{ color: '#ef4444' }}>*</span>{' '}
            <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>
              ({uploadedUrls.length}/6, 권장 3장)
            </span>
          </label>

          {/* 업로드 영역 */}
          {uploadedUrls.length < 6 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${C.border}`,
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#fafafa',
                marginBottom: uploadedUrls.length > 0 ? '10px' : undefined,
              }}
            >
              {uploading ? (
                <div style={{ fontSize: '13px', color: C.textSub }}>업로드 중...</div>
              ) : (
                <>
                  <div style={{ fontSize: '24px', marginBottom: '4px' }}>📷</div>
                  <div style={{ fontSize: '12px', color: C.textSub }}>
                    클릭하여 이미지 선택
                    <br />
                    JPG, PNG, WebP · 최대 10MB
                  </div>
                </>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files) onUploadFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* 업로드된 이미지 썸네일 */}
          {uploadedUrls.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {uploadedUrls.map((url, idx) => (
                <div key={url} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`참고 이미지 ${idx + 1}`}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: `1px solid ${C.border}`,
                    }}
                  />
                  <button
                    onClick={() => onRemoveImage(idx)}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* 생성 버튼 (하단 고정) */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            fontWeight: 700,
            borderRadius: '8px',
            border: 'none',
            background: canGenerate ? '#7c3aed' : C.border,
            color: canGenerate ? '#fff' : C.textSub,
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {isGenerating ? '✨ 생성 중...' : '✨ AI 상세페이지 생성'}
        </button>
        {!productName.trim() && (
          <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
            상품명을 입력하세요
          </div>
        )}
        {productName.trim() && uploadedUrls.length === 0 && (
          <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
            이미지를 1장 이상 업로드하세요
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx
git commit -m "feat: DetailMakerInputPanel 컴포넌트 추가"
```

---

## Task 3: 페이지 shell (page.tsx) 생성

**Files:**
- Create: `src/app/listing/detail-maker/page.tsx`

> `src/app/listing/layout.tsx`가 이미 `<AppShell>{children}</AppShell>`을 제공한다. 이 파일에서 AppShell을 다시 감싸면 절대 안 된다.

- [ ] **Step 1: page.tsx 생성**

`src/app/listing/detail-maker/page.tsx` 파일을 생성한다:

```tsx
import type { Metadata } from 'next';
import DetailMakerClient from './DetailMakerClient';

export const metadata: Metadata = {
  title: '상품상세 자동만들기 | SmartSellerStudio',
  description: 'AI로 상품 상세페이지를 1분 만에 자동 생성',
};

export default function DetailMakerPage() {
  return <DetailMakerClient />;
}
```

- [ ] **Step 2: 커밋 (DetailMakerClient와 함께 커밋할 것이므로 스테이징만)**

```bash
git add src/app/listing/detail-maker/page.tsx
```

---

## Task 4: DetailMakerClient 메인 컨테이너 생성

**Files:**
- Create: `src/app/listing/detail-maker/DetailMakerClient.tsx`

이 파일이 이번 기능의 핵심이다. 모든 상태, API 호출, 핸들러를 여기에 집중한다.

- [ ] **Step 1: DetailMakerClient.tsx 생성**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 파일을 생성한다:

```tsx
'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import { contentToSections } from '@/lib/detail-page/section-parser';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

type Category = 'basic' | 'fashion' | 'living' | 'food';

export default function DetailMakerClient() {
  // 입력
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState<Category>('basic');
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // 결과
  const [sections, setSections] = useState<DetailSection[]>([]);
  const [theme, setTheme] = useState<DetailPageTheme>(DEFAULT_THEME);
  const [generatedHtml, setGeneratedHtml] = useState<string>('');

  // 진행 상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── 이미지 업로드 ──────────────────────────────────────────────────────────
  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('usageContext', 'listing_detail');
    const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? `업로드 실패 (${res.status})`);
    return json.data.url as string;
  }

  async function handleUploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      const arr = Array.from(files).slice(0, 6 - uploadedUrls.length);
      const urls = await Promise.all(arr.map(uploadOne));
      setUploadedUrls(prev => [...prev, ...urls].slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveImage(idx: number) {
    setUploadedUrls(prev => prev.filter((_, i) => i !== idx));
  }

  // ─── render API 헬퍼 ────────────────────────────────────────────────────────
  async function refreshRenderedHtml(
    nextSections: DetailSection[],
    nextTheme: DetailPageTheme,
  ) {
    if (nextSections.length === 0) return;
    setIsRendering(true);
    setError(null);
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: nextSections, theme: nextTheme }),
      });
      const json = await res.json();
      if (res.ok) {
        setGeneratedHtml(json.html);
      } else {
        setError(json.error ?? '미리보기 갱신에 실패했습니다.');
      }
    } catch {
      setError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  }

  // ─── AI 생성 ────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
    if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          productName: productName.trim(),
          category,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `생성 실패 (${res.status})`);

      setGeneratedHtml(json.html);

      if (json.content) {
        try {
          const parsed = contentToSections(json.content as DetailPageContent);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] contentToSections 실패:', e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  }

  // ─── 섹션/테마 변경 ─────────────────────────────────────────────────────────
  function handleSectionsChange(next: DetailSection[]) {
    setSections(next);
    void refreshRenderedHtml(next, theme);
  }

  function handleThemeChange(next: DetailPageTheme) {
    setTheme(next);
    void refreshRenderedHtml(sections, next);
  }

  // ─── 섹션 AI 편집 ───────────────────────────────────────────────────────────
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
    await refreshRenderedHtml(updated, theme);
  }

  // ─── HTML 복사 / 다운로드 ────────────────────────────────────────────────────
  async function handleHtmlCopy() {
    await navigator.clipboard.writeText(generatedHtml).catch(() => {});
  }

  function handleDownload() {
    const blob = new Blob([generatedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '100vh', background: C.bg }}>
      {/* 좌측 300px 입력 패널 */}
      <DetailMakerInputPanel
        productName={productName}
        setProductName={setProductName}
        brandName={brandName}
        setBrandName={setBrandName}
        category={category}
        setCategory={setCategory}
        uploadedUrls={uploadedUrls}
        uploading={uploading}
        isGenerating={isGenerating}
        error={error}
        onUploadFiles={handleUploadFiles}
        onRemoveImage={handleRemoveImage}
        onGenerate={handleGenerate}
      />

      {/* 우측 — DetailPageEditor 또는 EmptyState */}
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
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: C.textSub,
              gap: '12px',
            }}
          >
            {isGenerating ? (
              <>
                <div style={{ fontSize: '32px' }}>✨</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>AI가 상세페이지를 생성하고 있어요</div>
                <div style={{ fontSize: '13px' }}>잠시만 기다려주세요 (30~60초 소요)</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px' }}>📄</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>상품상세 자동만들기</div>
                <div style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
                  왼쪽에서 상품명과 이미지를 입력하고
                  <br />
                  AI 생성 버튼을 눌러보세요
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 개발 서버에서 동작 확인**

브라우저에서 `/listing/detail-maker` 접속:
- 좌측 300px 입력 패널이 보임
- 우측에 EmptyState("상품상세 자동만들기") 표시
- 상품명 미입력 시 생성 버튼 비활성화(회색)
- 콘솔 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/listing/detail-maker/page.tsx src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: 상품상세 자동만들기 페이지 및 클라이언트 컨테이너 구현"
```

---

## Task 5: E2E 동작 검증

실제 생성 흐름을 수동으로 테스트한다.

- [ ] **Step 1: 이미지 업로드 테스트**

1. `/listing/detail-maker` 접속
2. 이미지 업로드 영역 클릭 → 파일 선택 (JPG/PNG 1장)
3. 확인 항목:
   - 썸네일 그리드에 이미지 표시
   - `×` 버튼 클릭 시 이미지 삭제
   - 6장 초과 시 업로드 영역 숨김
   - 업로드 중 "업로드 중..." 텍스트 표시

- [ ] **Step 2: AI 생성 테스트**

1. 상품명 입력: "무선 블루투스 이어폰"
2. 이미지 1~3장 업로드
3. "✨ AI 상세페이지 생성" 버튼 클릭
4. 확인 항목:
   - 생성 중 버튼 → "✨ 생성 중..." 텍스트 + 비활성화
   - 우측 EmptyState → "AI가 상세페이지를 생성하고 있어요" 표시
   - 생성 완료 → `DetailPageEditor` 마운트 (섹션 카드 목록 + 오른쪽 iframe 미리보기)
   - 콘솔에 에러 없음

- [ ] **Step 3: 편집 기능 테스트**

1. 생성 완료 후 섹션 카드에서 텍스트 인라인 편집
2. 테마 변경 → 미리보기 자동 갱신
3. 섹션 AI 편집(✨ 버튼) → 지시문 입력 → 편집 후 미리보기 갱신
4. "다운로드" 버튼 → `detail-page.html` 파일 다운로드 확인

- [ ] **Step 4: 에러 케이스 테스트**

1. 상품명 없이 생성 버튼 클릭 불가 확인(비활성화)
2. 이미지 없이 생성 버튼 클릭 불가 확인(비활성화)

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "feat: 상품상세 자동만들기 Phase 1 완료"
```

---

## 구현 후 주의사항 (스펙 v3 검증 포인트)

1. **upload-image 응답**: `json.data.url` (중첩 구조 — `json.url`이 아님)
2. **generate-detail-html**: `studioMode` 생략 가능 (Phase 1에서는 `imageUrls + productName + category`만 전달)
3. **contentToSections**: `headline` 또는 `ctaText` 비어있으면 throw → try/catch로 감싸야 함 (Task 4 코드에 이미 반영)
4. **render API palette**: 5종만 허용 (`warm_cream | cool_white | deep_dark | nature_green | tech_navy`) — DEFAULT_THEME의 `warm_cream`은 안전
5. **AppShell layout 중복 금지**: `src/app/listing/layout.tsx`가 이미 AppShell 제공 → detail-maker에 별도 layout.tsx 생성 금지
6. **DetailPageEditor height**: 부모 컨테이너에 `height: '100%'` + `minHeight: '100vh'` 필요 (Task 4 코드에 반영)
