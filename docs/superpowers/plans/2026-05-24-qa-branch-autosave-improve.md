# Q&A 분기 UI · 임시저장 · 개선 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자산 탭 URL 모드에 "AI와 함께 만들기" 분기를 추가하고, Q&A 세션을 localStorage에 자동저장하며, 자동 생성 결과에 "Q&A로 개선하기" 버튼을 추가한다.

**Architecture:**
- `qa-session-draft.ts` (신규) — localStorage TTL 저장소. `ConversationalDetailModal`이 답변마다 호출해 세션을 보존한다.
- `ConversationalDetailModal` — `initialAnswers` prop으로 이전 답변 복원. 답변마다 auto-save, 완료 시 clear.
- `AssetsInputPanel` — URL 모드에 카테고리 선택 + "💬 AI와 함께" 버튼 추가. 클릭 시 이미지 추출 후 Q&A 모달 오픈.
- `AssetsResultPanel` — 상세페이지 섹션 헤더에 "💬 Q&A로 개선하기" 버튼 추가.

**Tech Stack:** Next.js App Router, Zustand, React, TypeScript, Vitest

---

## File Map

| 파일 | 작업 |
|------|------|
| `src/lib/listing/qa-session-draft.ts` | 신규 — localStorage Q&A 세션 CRUD |
| `src/__tests__/lib/qa-session-draft.test.ts` | 신규 — 위 파일 단위 테스트 |
| `src/components/listing/assets/ConversationalDetailModal.tsx` | 수정 — `initialAnswers` prop, auto-save, clear |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 — URL 모드 분기 UI + Q&A 추출 흐름 |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 — "Q&A로 개선하기" 버튼 + 인라인 모달 |
| `src/__tests__/components/assets-input-panel.test.tsx` | 수정 — URL 모드 Q&A 버튼 테스트 추가 |

---

## Task 1: qa-session-draft.ts 생성

**Files:**
- Create: `src/lib/listing/qa-session-draft.ts`

- [ ] **Step 1: 파일 작성**

```typescript
// src/lib/listing/qa-session-draft.ts
import type { QuestionAnswer } from '@/lib/conversational-detail/types';

const TTL_MS = 24 * 60 * 60 * 1000;

interface QASessionRecord {
  answers: QuestionAnswer[];
  savedAt: number;
}

function makeKey(productName: string): string {
  return `qa_session_${productName.slice(0, 30).replace(/\s+/g, '_')}`;
}

export function saveQASession(productName: string, answers: QuestionAnswer[]): void {
  if (typeof localStorage === 'undefined') return;
  const record: QASessionRecord = { answers, savedAt: Date.now() };
  try {
    localStorage.setItem(makeKey(productName), JSON.stringify(record));
  } catch {
    // localStorage 용량 초과 등 무시
  }
}

export function loadQASession(productName: string): QuestionAnswer[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(makeKey(productName));
    if (!raw) return null;
    const record = JSON.parse(raw) as QASessionRecord;
    if (Date.now() - record.savedAt > TTL_MS) {
      localStorage.removeItem(makeKey(productName));
      return null;
    }
    return record.answers;
  } catch {
    return null;
  }
}

export function clearQASession(productName: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(makeKey(productName));
  } catch {
    // 무시
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/listing/qa-session-draft.ts
git commit -m "feat: Q&A 세션 localStorage 자동저장 유틸 추가"
```

---

## Task 2: qa-session-draft 단위 테스트

**Files:**
- Create: `src/__tests__/lib/qa-session-draft.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/__tests__/lib/qa-session-draft.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveQASession, loadQASession, clearQASession } from '@/lib/listing/qa-session-draft';

const PRODUCT = '테스트상품';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('saveQASession / loadQASession', () => {
  it('저장 후 로드하면 같은 answers를 반환한다', () => {
    const answers = [{ questionId: 'target', resolvedValue: '30대 여성' }];
    saveQASession(PRODUCT, answers);
    expect(loadQASession(PRODUCT)).toEqual(answers);
  });

  it('24시간이 지난 세션은 null을 반환하고 항목을 삭제한다', () => {
    const answers = [{ questionId: 'tone', resolvedValue: '감성적' }];
    saveQASession(PRODUCT, answers);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(loadQASession(PRODUCT)).toBeNull();
    expect(localStorage.getItem(`qa_session_${PRODUCT}`)).toBeNull();
  });

  it('저장된 항목이 없으면 null을 반환한다', () => {
    expect(loadQASession('없는상품')).toBeNull();
  });
});

describe('clearQASession', () => {
  it('저장 후 clear하면 null을 반환한다', () => {
    saveQASession(PRODUCT, [{ questionId: 'usp', resolvedValue: '가볍다' }]);
    clearQASession(PRODUCT);
    expect(loadQASession(PRODUCT)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 확인**

```bash
npx vitest run src/__tests__/lib/qa-session-draft.test.ts
```

Expected: 4 tests passed

- [ ] **Step 3: 커밋**

```bash
git add src/__tests__/lib/qa-session-draft.test.ts
git commit -m "test: qa-session-draft 단위 테스트 추가"
```

---

## Task 3: ConversationalDetailModal — initialAnswers + auto-save + clear

**Files:**
- Modify: `src/components/listing/assets/ConversationalDetailModal.tsx`

- [ ] **Step 1: Props 인터페이스 수정**

`ConversationalDetailModal.tsx` 상단 `Props` 인터페이스에 `initialAnswers` 추가:

```typescript
// 기존
interface Props {
  productName: string;
  category: CategoryKey;
  imageUrls: string[];
  onClose: () => void;
  onComplete: (result: {
    html: string;
    content?: DetailPageContent;
    conversationContext: ConversationContext;
  }) => void;
}

// 변경 후
interface Props {
  productName: string;
  category: CategoryKey;
  imageUrls: string[];
  initialAnswers?: QuestionAnswer[];  // <-- 추가
  onClose: () => void;
  onComplete: (result: {
    html: string;
    content?: DetailPageContent;
    conversationContext: ConversationContext;
  }) => void;
}
```

- [ ] **Step 2: import 추가**

파일 상단 import 블록에 qa-session-draft import 추가:

```typescript
import { saveQASession, clearQASession } from '@/lib/listing/qa-session-draft';
```

- [ ] **Step 3: 초기 state 수정 (initialAnswers 반영)**

`useReducer` 초기값을 아래로 교체 (기존 `answers: [], currentIndex: 0` 부분):

```typescript
// initialAnswers가 있으면 pre-populate, currentIndex는 answers 수만큼 건너뜀
const initialIndex = initialAnswers && initialAnswers.length >= questions.length
  ? questions.length  // 리뷰 화면으로 바로 이동
  : (initialAnswers?.length ?? 0);

const [state, dispatch] = useReducer(reducer, {
  phase: 'loading_suggestions' as Phase,
  questions,
  suggestions: [],
  answers: initialAnswers ?? [],
  currentIndex: initialIndex,
  error: null,
});
```

- [ ] **Step 4: set_answer 액션에서 auto-save 호출**

`reducer` 함수의 `set_answer` case 뒤에, 컴포넌트 레벨에서 dispatch를 래핑하는 헬퍼를 추가:

기존 `handleChipSelect`, `handleFreeTextSubmit`, `handleDelegate` 에서 `dispatch({ type: 'set_answer', ... })` 를 직접 호출하는 대신, 아래 헬퍼로 교체:

```typescript
// dispatch + auto-save 래퍼 (컴포넌트 내부에 선언)
const dispatchAnswer = (answer: QuestionAnswer) => {
  dispatch({ type: 'set_answer', answer });
  saveQASession(productName, [...state.answers.filter(a => a.questionId !== answer.questionId), answer]);
};
```

그리고 `handleChipSelect` / `handleFreeTextSubmit` / `handleDelegate`의 `dispatch({ type: 'set_answer', ... })` 를 `dispatchAnswer(...)` 로 교체:

```typescript
// handleChipSelect
const handleChipSelect = (chip: string) => {
  if (!currentQuestion) return;
  dispatchAnswer({
    questionId: currentQuestion.id,
    selectedChip: chip,
    resolvedValue: chip,
  });
};

// handleFreeTextSubmit
const handleFreeTextSubmit = () => {
  if (!currentQuestion) return;
  const value = freeText.trim();
  if (!value) return;
  dispatchAnswer({
    questionId: currentQuestion.id,
    freeText: value,
    resolvedValue: value,
  });
};

// handleDelegate 내 dispatch 교체 (catch 전)
dispatchAnswer({
  questionId: currentQuestion.id,
  delegatedToAi: true,
  resolvedValue: json.data.value,
});
```

- [ ] **Step 5: handleGenerate 완료 시 clearQASession 호출**

`handleGenerate` 함수 내 `onComplete` 호출 직전에 추가:

```typescript
// 기존 onComplete 직전
clearQASession(productName);
onComplete({ html: json.html, content: json.content, conversationContext });
```

- [ ] **Step 6: 테스트 실행 (기존 conversational-detail-modal 테스트)**

```bash
npx vitest run src/__tests__/components/conversational-detail-modal.test.tsx
```

Expected: 모두 통과

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/assets/ConversationalDetailModal.tsx
git commit -m "feat: ConversationalDetailModal — initialAnswers prop, Q&A auto-save, 완료 시 세션 clear"
```

---

## Task 4: AssetsInputPanel — URL 모드 분기 UI

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`

이 태스크에서 URL 모드에:
1. 카테고리 선택 칩 추가
2. "💬 AI와 함께 만들기" 버튼 추가
3. 버튼 클릭 시 이미지 추출 → Q&A 모달 오픈 흐름 추가

- [ ] **Step 1: URL 모드 Q&A 가능 조건 추가**

기존 `canStartConversation` 정의 아래에 URL 모드용 조건 추가:

```typescript
// 기존 (upload 전용)
const canStartConversation =
  !isGenerating &&
  mode === 'upload' &&
  (thumbnailFiles.length > 0 || detailFiles.length > 0) &&
  sharedDraft.name.trim().length > 0 &&
  category !== null;

// 추가: URL 모드 Q&A 조건 (이미지 추출 후 모달 오픈)
const canStartUrlQA =
  !isGenerating &&
  mode === 'url' &&
  url.trim().length > 0 &&
  category !== null;
```

- [ ] **Step 2: handleStartUrlQA 함수 추가**

`AssetsInputPanel` 내부에 아래 함수 추가 (기존 `handleConversationComplete` 아래):

```typescript
const handleStartUrlQA = async () => {
  updateAssetsDraft({ isGenerating: true, generatingMessage: '이미지 가져오는 중...', lastError: null });
  try {
    const res = await fetch('/api/listing/assets/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'url', url: url.trim() }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`이미지 추출 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { thumbnails: string[]; detailHtml: string };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? '이미지 추출 실패');
    }
    const thumbnails = json.data.thumbnails ?? [];
    // 썸네일만 저장 (HTML 생성 없이 Q&A로 넘긴다)
    updateAssetsDraft({
      isGenerating: false,
      generatingMessage: null,
      generatedThumbnails: thumbnails,
    });
    setConversationModalOpen(true);
  } catch (e) {
    updateAssetsDraft({
      isGenerating: false,
      generatingMessage: null,
      lastError: e instanceof Error ? e.message : '이미지 추출 중 오류',
    });
  }
};
```

- [ ] **Step 3: URL 모드 카테고리 칩 추가**

`AssetsInputPanel` render 내 URL 모드(`mode === 'url'`) 구간에, URL 입력 필드 바로 아래에 카테고리 칩을 추가한다. 기존:

```tsx
{mode === 'url' ? (
  <input
    type="url"
    ...
  />
) : (
```

변경 후:

```tsx
{mode === 'url' ? (
  <>
    <input
      type="url"
      value={url}
      onChange={(e) => updateAssetsDraft({ url: e.target.value })}
      placeholder="https://"
      style={{
        width: '100%',
        padding: '10px 14px',
        fontSize: '13px',
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        outline: 'none',
        color: C.text,
        backgroundColor: '#fff',
        boxSizing: 'border-box',
      }}
    />
    {/* URL 모드에서도 카테고리 선택 (AI와 함께 만들기 활성화용) */}
    <div>
      <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>
        카테고리 (AI와 함께 만들기 시 필수)
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {CATEGORY_OPTIONS.map((opt) => {
          const selected = category === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => updateAssetsDraft({ category: opt.key })}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: '999px',
                border: `1px solid ${selected ? C.accent : C.border}`,
                backgroundColor: selected ? C.accent : '#fff',
                color: selected ? '#fff' : C.text,
                cursor: 'pointer',
                fontWeight: selected ? 700 : 500,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  </>
) : (
```

- [ ] **Step 4: "💬 AI와 함께 만들기" 버튼을 URL 모드에도 추가**

기존 버튼 영역:

```tsx
{/* 자산 생성 / 대화로 만들기 버튼 */}
<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
  <button type="button" onClick={onGenerate} disabled={!canGenerate} ...>
    {isGenerating ? '생성 중...' : '빠른 생성 (폼)'}
  </button>
  {mode === 'upload' && (
    <button type="button" onClick={() => setConversationModalOpen(true)} disabled={!canStartConversation} ...>
      💬 대화로 만들기
    </button>
  )}
</div>
```

변경 후:

```tsx
<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
  <button type="button" onClick={onGenerate} disabled={!canGenerate}
    style={{
      padding: '10px 20px', fontSize: '13px', fontWeight: 700,
      backgroundColor: canGenerate ? C.accent : C.border,
      color: canGenerate ? '#fff' : C.textSub,
      border: 'none', borderRadius: '8px',
      cursor: canGenerate ? 'pointer' : 'not-allowed',
    }}
  >
    {isGenerating ? '생성 중...' : '⚡ 자동 생성'}
  </button>

  {/* 업로드 모드 Q&A */}
  {mode === 'upload' && (
    <button
      type="button"
      onClick={() => setConversationModalOpen(true)}
      disabled={!canStartConversation}
      title={canStartConversation ? 'AI 마케터와 대화하며 상세페이지 작성' : '이미지·상품명·카테고리를 모두 입력하면 활성화됩니다'}
      style={{
        padding: '10px 20px', fontSize: '13px', fontWeight: 700,
        backgroundColor: canStartConversation ? '#7c3aed' : C.border,
        color: canStartConversation ? '#fff' : C.textSub,
        border: 'none', borderRadius: '8px',
        cursor: canStartConversation ? 'pointer' : 'not-allowed',
      }}
    >
      💬 AI와 함께 만들기
    </button>
  )}

  {/* URL 모드 Q&A: 이미지 추출 후 Q&A 모달 오픈 */}
  {mode === 'url' && (
    <button
      type="button"
      onClick={() => void handleStartUrlQA()}
      disabled={!canStartUrlQA}
      title={canStartUrlQA ? 'URL에서 이미지를 가져와 AI와 대화하며 상세페이지 작성' : 'URL과 카테고리를 입력하면 활성화됩니다'}
      style={{
        padding: '10px 20px', fontSize: '13px', fontWeight: 700,
        backgroundColor: canStartUrlQA ? '#7c3aed' : C.border,
        color: canStartUrlQA ? '#fff' : C.textSub,
        border: 'none', borderRadius: '8px',
        cursor: canStartUrlQA ? 'pointer' : 'not-allowed',
      }}
    >
      💬 AI와 함께 만들기
    </button>
  )}
</div>
```

- [ ] **Step 5: URL 모드 Q&A 모달 조건 수정**

기존:
```tsx
{conversationModalOpen && category !== null && (
  <ConversationalDetailModal
    productName={sharedDraft.name}
    category={category}
    imageUrls={conversationImageUrls}
    onClose={...}
    onComplete={handleConversationComplete}
  />
)}
```

URL 모드에서는 `conversationImageUrls`가 `generatedThumbnails`여야 함. 수정:

```typescript
// conversationImageUrls 재정의: URL 모드면 generatedThumbnails, 업로드 모드면 기존 로직
const conversationImageUrls =
  mode === 'url'
    ? assetsDraft.generatedThumbnails
    : detailFiles.length > 0
      ? detailFiles
      : thumbnailFiles;
```

그리고 `ConversationalDetailModal`에 `initialAnswers` 전달:

```tsx
{conversationModalOpen && category !== null && (
  <ConversationalDetailModal
    productName={sharedDraft.name}
    category={category}
    imageUrls={conversationImageUrls}
    initialAnswers={
      assetsDraft.conversationAnswers.length > 0
        ? assetsDraft.conversationAnswers
        : undefined
    }
    onClose={() => setConversationModalOpen(false)}
    onComplete={handleConversationComplete}
  />
)}
```

- [ ] **Step 6: 테스트 실행**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx
```

Expected: 기존 4개 테스트 모두 통과

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx
git commit -m "feat: URL 모드 AI와 함께 만들기 분기 UI — 카테고리 선택 + 이미지 추출 후 Q&A 모달"
```

---

## Task 5: AssetsResultPanel — "Q&A로 개선하기" 버튼

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx`

- [ ] **Step 1: import 추가**

파일 상단에 추가:

```typescript
import ConversationalDetailModal from './ConversationalDetailModal';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { CategoryKey } from '@/lib/conversational-detail/types';
import { CATEGORY_OPTIONS } from '@/lib/listing/category-options'; // 없으면 인라인 정의
```

`CATEGORY_OPTIONS`는 현재 `AssetsInputPanel.tsx` 안에 로컬 상수로 있음. AssetsResultPanel에도 동일 배열을 인라인으로 선언:

```typescript
const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: 'basic', label: '기본' },
  { key: 'fashion', label: '패션' },
  { key: 'living', label: '리빙' },
  { key: 'food', label: '식품' },
];
```

- [ ] **Step 2: sharedDraft 읽기 + 새 state 추가**

기존:
```typescript
const { assetsDraft, updateAssetsDraft } = useListingStore();
```

변경 후:
```typescript
const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();
```

컴포넌트 내 useState 블록에 추가:
```typescript
const [improveModalOpen, setImproveModalOpen] = useState(false);
const [improveCategory, setImproveCategory] = useState<CategoryKey>('basic');
const [showCategoryPicker, setShowCategoryPicker] = useState(false);
```

- [ ] **Step 3: handleImproveComplete 함수 추가**

`handleSectionAiEdit` 등 기존 함수들 아래에 추가:

```typescript
const handleImproveComplete = ({
  html,
  content,
  conversationContext,
}: {
  html: string;
  content?: import('@/lib/ai/prompts/detail-page').DetailPageContent;
  conversationContext: import('@/lib/conversational-detail/types').ConversationContext;
}) => {
  let detailPageSections = assetsDraft.detailPageSections;
  if (content) {
    try {
      detailPageSections = contentToSections(content);
    } catch {
      // 파싱 실패 시 silent fallback
    }
  }
  updateAssetsDraft({
    generatedDetailHtml: html,
    detailPageSections,
    conversationAnswers: conversationContext.answers,
    lastError: null,
  });
  setImproveModalOpen(false);
  setShowCategoryPicker(false);
};

const handleImproveButtonClick = () => {
  const cat = assetsDraft.category;
  if (cat) {
    setImproveCategory(cat);
    setImproveModalOpen(true);
  } else {
    setShowCategoryPicker(true);
  }
};
```

- [ ] **Step 4: 상세페이지 섹션 헤더에 버튼 추가**

기존 상세페이지 헤더:

```tsx
<div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
  <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지</span>
</div>
```

변경 후:

```tsx
<div style={{
  padding: '12px 16px',
  borderBottom: `1px solid ${C.border}`,
  backgroundColor: C.tableHeader,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}}>
  <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지</span>
  <button
    type="button"
    onClick={handleImproveButtonClick}
    style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '5px 12px', fontSize: '12px', fontWeight: 600,
      backgroundColor: '#fff', color: '#7c3aed',
      border: '1px solid #ddd6fe', borderRadius: '8px',
      cursor: 'pointer',
    }}
  >
    💬 Q&A로 개선하기
  </button>
</div>

{/* 카테고리 선택 필요 시 인라인 피커 */}
{showCategoryPicker && (
  <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: '#f5f3ff' }}>
    <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#5b21b6' }}>카테고리를 선택하세요</p>
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {CATEGORY_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => {
            setImproveCategory(opt.key);
            updateAssetsDraft({ category: opt.key });
            setShowCategoryPicker(false);
            setImproveModalOpen(true);
          }}
          style={{
            padding: '5px 12px', fontSize: '12px', borderRadius: '999px',
            border: '1px solid #ddd6fe', backgroundColor: '#fff',
            color: '#5b21b6', cursor: 'pointer',
          }}
        >
          {opt.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setShowCategoryPicker(false)}
        style={{
          padding: '5px 12px', fontSize: '12px', borderRadius: '999px',
          border: '1px solid #e5e7eb', backgroundColor: '#fff',
          color: '#6b7280', cursor: 'pointer',
        }}
      >
        취소
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 5: ConversationalDetailModal 렌더 추가 (AssetsResultPanel 하단)**

기존 `{/* 두 이미지 합치기 모달 */}` 블록 아래에 추가:

```tsx
{/* Q&A 개선 모달 */}
{improveModalOpen && (
  <ConversationalDetailModal
    productName={sharedDraft.name}
    category={improveCategory}
    imageUrls={assetsDraft.generatedThumbnails}
    initialAnswers={
      assetsDraft.conversationAnswers.length > 0
        ? assetsDraft.conversationAnswers
        : undefined
    }
    onClose={() => { setImproveModalOpen(false); setShowCategoryPicker(false); }}
    onComplete={handleImproveComplete}
  />
)}
```

- [ ] **Step 6: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음. 에러 있으면 import 누락/타입 불일치 수정.

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/assets/AssetsResultPanel.tsx
git commit -m "feat: 상세페이지 결과에 'Q&A로 개선하기' 버튼 추가 — 이전 답변 pre-load 지원"
```

---

## Task 6: AssetsInputPanel 테스트 보강

**Files:**
- Modify: `src/__tests__/components/assets-input-panel.test.tsx`

- [ ] **Step 1: URL 모드 Q&A 버튼 테스트 추가**

기존 테스트 파일 끝에 추가:

```typescript
it('URL 모드에서 카테고리 선택 전에는 "AI와 함께 만들기" 버튼이 비활성화된다', () => {
  const store = useListingStore.getState();
  store.resetAssetsDraft();
  store.updateAssetsDraft({ mode: 'url', url: 'https://example.com/product', category: null });

  render(<AssetsInputPanel onGenerate={() => {}} />);
  const btn = screen.getByRole('button', { name: /AI와 함께 만들기/ });
  expect(btn).toBeDisabled();
});

it('URL 모드에서 URL + 카테고리 입력 시 "AI와 함께 만들기" 버튼이 활성화된다', () => {
  const store = useListingStore.getState();
  store.resetAssetsDraft();
  store.updateAssetsDraft({ mode: 'url', url: 'https://example.com/product', category: 'basic' });

  render(<AssetsInputPanel onGenerate={() => {}} />);
  const btn = screen.getByRole('button', { name: /AI와 함께 만들기/ });
  expect(btn).not.toBeDisabled();
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx
```

Expected: 6개 이상 테스트 모두 통과

- [ ] **Step 3: 커밋**

```bash
git add src/__tests__/components/assets-input-panel.test.tsx
git commit -m "test: URL 모드 AI와 함께 만들기 버튼 활성화 조건 테스트 추가"
```

---

## Task 7: 전체 테스트 실행 + 최종 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 기존 테스트 전부 통과 + 신규 6개 통과

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: 최종 커밋 (필요 시)**

변경 파일이 남아 있으면:

```bash
git add -p
git commit -m "chore: Q&A 분기 UI 타입 정리"
```

---

## Self-Review

### Spec 커버리지 확인

| 요구사항 | 구현 Task |
|----------|----------|
| URL 입력 → 이미지 추출 → 분기 선택 | Task 4 (AssetsInputPanel URL 모드 분기) |
| AI와 함께 만들기 / 자동 생성 버튼 카드 | Task 4 Step 3–4 |
| Q&A 세션 임시저장 | Task 1 (qa-session-draft), Task 3 (auto-save on answer) |
| Q&A 중단 후 복원 | Task 3 (initialAnswers pre-populate) |
| 자동 생성 결과에 "Q&A로 개선하기" 버튼 | Task 5 (AssetsResultPanel) |
| 이전 Q&A 답변 pre-load | Task 3 Step 3, Task 5 Step 5 |

### Placeholder 없음 확인

모든 Step에 실제 코드가 포함됨. "TBD" 없음.

### 타입 일관성 확인

- `QuestionAnswer` — `src/lib/conversational-detail/types.ts` 정의, Task 3·5에서 동일 타입 참조
- `CategoryKey` — 동일 파일 정의, Task 4·5에서 동일 타입 참조
- `initialAnswers?: QuestionAnswer[]` — Task 3 Props, Task 4 Step 5, Task 5 Step 5에서 동일 prop 이름 사용
