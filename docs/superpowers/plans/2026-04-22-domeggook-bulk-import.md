# 도매꾹 대량 등록 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도매꾹 상품번호를 여러 개 입력하면 순차적으로 AI 처리(썸네일·상세페이지·가격 계산)하고, 결과를 테이블로 보여준 뒤 각 상품을 기존 등록 패널로 연결한다.

**Architecture:** 기존 `/api/listing/domeggook/prepare` (단건 처리)를 순차 큐로 반복 호출한다. `/api/listing/both`는 카테고리 코드 등 복잡한 필드가 필요하므로 직접 호출하지 않는다. 대신 "등록" 버튼 클릭 시 기존 DomeggookPreparePanel 모달을 `initialItemNo`로 열어 카테고리 선택 및 최종 등록은 기존 단건 흐름을 재사용한다. 이를 통해 UI 중복 없이 빠르게 구현한다.

**Tech Stack:** Next.js 15 App Router, React, Zustand, TypeScript, 기존 `/api/listing/domeggook/prepare` + `/api/listing/both` API

---

## 사전 조건 (수동 작업 — 소프트웨어 개발 전 완료)

아래는 코드 작업이 아닌 셀러 비즈니스 액션입니다. 개발과 병행 진행합니다.

### 아이템스카우트 키워드 발굴 체크리스트

- [ ] 아이템스카우트(itemscout.io) 접속
- [ ] 다음 키워드를 하나씩 검색 후 결과 기록:
  - `여성 미니 배낭` — 목표: 월 검색량 3,000~30,000 / 경쟁 500개 미만
  - `초등학생 책가방 배낭`
  - `등산 배낭 30L`
  - `방수 백팩 직장인`
  - `캐주얼 백팩 여성`
  - `USB 케이블 정리 클립`
  - `모니터 받침대 원목`
  - `노트북 거치대 접이식`
  - `데스크 수납 트레이`
  - `마우스패드 XXL`
- [ ] 조건 충족 키워드마다 도매꾹에서 매칭 상품 5개씩 상품번호 메모
- [ ] 상품번호 목록 완성 (총 70개 목표)

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `src/types/bulkImport.ts` | 신규 생성 | BulkImportItem, 큐 상태 타입 |
| `src/hooks/useImportQueue.ts` | 신규 생성 | 순차 처리 큐 로직 |
| `src/components/listing/BulkImportPanel.tsx` | 신규 생성 | 메인 UI (입력 + 테이블 + 등록 버튼) |
| `src/components/listing/ListingDashboard.tsx` | 수정 | "대량 등록" 탭 추가 |

---

## Task 1: 타입 정의

**Files:**
- Create: `src/types/bulkImport.ts`

- [ ] **Step 1: 파일 생성**

```typescript
// src/types/bulkImport.ts

export type ImportItemStatus =
  | 'pending'      // 대기
  | 'processing'   // AI 처리 중
  | 'ready'        // 처리 완료, 등록 대기
  | 'failed';      // 실패

export interface BulkImportItem {
  id: string;           // 클라이언트 uuid (crypto.randomUUID())
  itemNo: number;
  status: ImportItemStatus;
  title?: string;
  thumbnailUrl?: string;
  recommendedPriceNaver?: number;
  recommendedPriceCoupang?: number;
  errorMessage?: string;
}

export interface SellerDefaults {
  sellerName: string;
  sellerBrandName: string;
  csPhone: string;
  csHours: string;
  returnAddress: string;
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/types/bulkImport.ts
git commit -m "feat: add BulkImportItem types"
```

---

## Task 2: useImportQueue 훅

**Files:**
- Create: `src/hooks/useImportQueue.ts`

- [ ] **Step 1: 훅 생성**

```typescript
// src/hooks/useImportQueue.ts
'use client';

import { useState, useRef, useCallback } from 'react';
import type { BulkImportItem, ImportItemStatus, SellerDefaults } from '@/types/bulkImport';

const STORAGE_KEY = 'sss_domeggook_seller_defaults';

function loadSellerDefaults(): SellerDefaults {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return JSON.parse(raw) as SellerDefaults;
  } catch { /* ignore */ }
  return { sellerName: '', sellerBrandName: '', csPhone: '', csHours: '', returnAddress: '' };
}

export function useImportQueue() {
  const [items, setItems] = useState<BulkImportItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<BulkImportItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // 도매꾹 URL 또는 숫자에서 상품번호 추출
  const parseItemNo = useCallback((raw: string): number | null => {
    const trimmed = raw.trim();
    // URL 형태: goods_no=XXXXX
    const urlMatch = trimmed.match(/[?&]goods_no=(\d+)/);
    if (urlMatch) return parseInt(urlMatch[1], 10);
    // 숫자만
    const numMatch = trimmed.match(/^\d+$/);
    if (numMatch) return parseInt(trimmed, 10);
    return null;
  }, []);

  // textarea 입력 → 큐 초기화
  const initQueue = useCallback((rawText: string) => {
    const lines = rawText.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
    const newItems: BulkImportItem[] = [];
    for (const line of lines) {
      const itemNo = parseItemNo(line);
      if (itemNo) {
        newItems.push({ id: crypto.randomUUID(), itemNo, status: 'pending' });
      }
    }
    setItems(newItems);
    return newItems.length;
  }, [parseItemNo]);

  // 순차 처리 시작
  const startProcessing = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    const seller = loadSellerDefaults();

    setItems((prev) => {
      // 처리 큐 스냅샷 — 실제 처리는 아래 루프에서
      return prev;
    });

    // 최신 items를 ref 없이 접근하기 위해 functional update 패턴 사용
    let snapshot: BulkImportItem[] = [];
    setItems((prev) => { snapshot = prev; return prev; });

    // 마이크로태스크 후 snapshot 확정
    await new Promise((r) => setTimeout(r, 0));
    setItems((prev) => { snapshot = prev; return prev; });

    for (const item of snapshot) {
      if (abortRef.current) break;
      if (item.status !== 'pending') continue;

      updateItem(item.id, { status: 'processing' });

      try {
        const res = await fetch('/api/listing/domeggook/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemNo: item.itemNo,
            sellerName: seller.sellerName || '판매자',
            sellerBrandName: seller.sellerBrandName || undefined,
            csPhone: seller.csPhone || '010-0000-0000',
            csHours: seller.csHours || '09:00-18:00',
            returnAddress: seller.returnAddress || undefined,
          }),
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          updateItem(item.id, { status: 'failed', errorMessage: json.error ?? '처리 실패' });
          continue;
        }

        const d = json.data;
        updateItem(item.id, {
          status: 'ready',
          title: d.source.title,
          thumbnailUrl: d.thumbnail.processedUrl,
          recommendedPriceNaver: d.pricing.naver.recommendedPrice,
          recommendedPriceCoupang: d.pricing.coupang.recommendedPrice,
          detailHtml: d.detail.processedHtml,
        });
      } catch (err) {
        updateItem(item.id, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : '네트워크 오류',
        });
      }

      // 도매꾹 API 레이트 리밋 방지 — 1.5초 간격
      await new Promise((r) => setTimeout(r, 1500));
    }

    setIsRunning(false);
  }, [updateItem]);

  const stopProcessing = useCallback(() => {
    abortRef.current = true;
  }, []);

  // 단건 등록: 기존 DomeggookPreparePanel 열기를 위해 itemNo 반환
  // 실제 플랫폼 등록은 DomeggookPreparePanel이 처리 — /api/listing/both는 여기서 직접 호출하지 않음
  const getItemNoForRegister = useCallback((id: string): number | null => {
    const item = items.find((it) => it.id === id);
    return item?.status === 'ready' ? item.itemNo : null;
  }, [items]);

  const clearFailed = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'failed'));
  }, []);

  const readyCount = items.filter((it) => it.status === 'ready').length;
  const failedCount = items.filter((it) => it.status === 'failed').length;

  return {
    items,
    isRunning,
    initQueue,
    startProcessing,
    stopProcessing,
    getItemNoForRegister,
    clearFailed,
    readyCount,
    failedCount,
  };
}
```

- [ ] **Step 2: 빌드 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음 (또는 기존 오류만)

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useImportQueue.ts
git commit -m "feat: add useImportQueue hook for sequential bulk import"
```

---

## Task 3: BulkImportPanel UI

**Files:**
- Create: `src/components/listing/BulkImportPanel.tsx`

- [ ] **Step 1: 컴포넌트 생성**

```typescript
// src/components/listing/BulkImportPanel.tsx
'use client';

import React, { useState } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import { useImportQueue } from '@/hooks/useImportQueue';
import DomeggookPreparePanel from '@/components/listing/DomeggookPreparePanel';
import type { BulkImportItem, ImportItemStatus } from '@/types/bulkImport';

const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#71717a',
  accent: '#be0014',
  green: '#16a34a',
  yellow: '#d97706',
  red: '#dc2626',
};

const STATUS_LABEL: Record<ImportItemStatus, string> = {
  pending: '대기',
  processing: '처리 중...',
  ready: '완료',
  failed: '실패',
};

const STATUS_COLOR: Record<ImportItemStatus, string> = {
  pending: C.textSub,
  processing: C.yellow,
  ready: C.green,
  failed: C.red,
};

export default function BulkImportPanel() {
  const [rawInput, setRawInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  // 등록 모달: ready 항목 클릭 시 itemNo를 저장 → DomeggookPreparePanel 모달로 열기
  const [registerItemNo, setRegisterItemNo] = useState<number | null>(null);
  const {
    items,
    isRunning,
    initQueue,
    startProcessing,
    stopProcessing,
    getItemNoForRegister,
    clearFailed,
    readyCount,
    failedCount,
  } = useImportQueue();

  function handleInit() {
    const count = initQueue(rawInput);
    if (count > 0) setInitialized(true);
  }

  return (
    <div style={{ padding: '24px 0' }}>
      {/* 입력 영역 */}
      {!initialized && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: C.textSub, margin: '0 0 12px' }}>
            도매꾹 상품번호 또는 URL을 한 줄에 하나씩 입력하세요 (최대 80개 권장)
          </p>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={`12345678\n87654321\nhttps://www.domeggook.com/...goods_no=99999999`}
            rows={10}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              resize: 'vertical',
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleInit}
            disabled={!rawInput.trim()}
            style={{
              marginTop: 12,
              padding: '9px 20px',
              fontSize: 13,
              fontWeight: 700,
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: rawInput.trim() ? 'pointer' : 'not-allowed',
              opacity: rawInput.trim() ? 1 : 0.5,
            }}
          >
            상품 목록 불러오기
          </button>
        </div>
      )}

      {/* 컨트롤 바 */}
      {initialized && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: C.textSub }}>
            총 {items.length}개 · 처리완료 {readyCount}개 · 실패 {failedCount}개
          </span>
          <div style={{ flex: 1 }} />
          {!isRunning ? (
            <button
              onClick={startProcessing}
              disabled={items.every((it) => it.status !== 'pending')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: C.accent, color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Play size={14} /> AI 처리 시작
            </button>
          ) : (
            <button
              onClick={stopProcessing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: '#6b7280', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Square size={14} /> 중지
            </button>
          )}
          {failedCount > 0 && (
            <button
              onClick={clearFailed}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 12,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Trash2 size={13} /> 실패 항목 제거
            </button>
          )}
          <button
            onClick={() => { setInitialized(false); setRawInput(''); }}
            style={{
              padding: '8px 14px', fontSize: 12,
              background: C.bg, color: C.textSub,
              border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
            }}
          >
            새로 입력
          </button>
        </div>
      )}

      {/* DomeggookPreparePanel 모달 — ready 항목 "등록" 클릭 시 열림 */}
      {registerItemNo !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', borderRadius: 12 }}>
            <DomeggookPreparePanel
              onClose={() => setRegisterItemNo(null)}
              onContinueToRegister={() => setRegisterItemNo(null)}
              initialItemNo={String(registerItemNo)}
            />
          </div>
        </div>
      )}

      {/* 결과 테이블 */}
      {items.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 80 }}>상품번호</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>상품명</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 100 }}>추천가(네이버)</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 90 }}>상태</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 80 }}>액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <BulkItemRow
                  key={item.id}
                  item={item}
                  isEven={idx % 2 === 0}
                  onRegister={() => {
                    const no = getItemNoForRegister(item.id);
                    if (no) setRegisterItemNo(no);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkItemRow({
  item,
  isEven,
  onRegister,
}: {
  item: BulkImportItem;
  isEven: boolean;
  onRegister: () => void;
}) {
  return (
    <tr style={{ background: isEven ? '#fff' : C.bg, borderTop: `1px solid ${C.border}` }}>
      <td style={{ padding: '10px 16px', color: C.textSub, fontFamily: 'monospace' }}>
        {item.itemNo}
      </td>
      <td style={{ padding: '10px 16px', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.thumbnailUrl && (
            <img
              src={item.thumbnailUrl}
              alt=""
              style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
            {item.title ?? (item.status === 'pending' ? '—' : '처리 중...')}
          </span>
        </div>
        {item.errorMessage && (
          <div style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{item.errorMessage}</div>
        )}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', color: C.text }}>
        {item.recommendedPriceNaver ? item.recommendedPriceNaver.toLocaleString('ko-KR') + '원' : '—'}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[item.status] }}>
          {STATUS_LABEL[item.status]}
        </span>
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
        {item.status === 'ready' && (
          <button
            onClick={onRegister}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 700,
              background: C.accent, color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            등록
          </button>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: 빌드 오류 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/BulkImportPanel.tsx
git commit -m "feat: add BulkImportPanel component"
```

---

## Task 4: ListingDashboard에 대량 등록 탭 추가

**Files:**
- Modify: `src/components/listing/ListingDashboard.tsx`

- [ ] **Step 1: import 추가**

`ListingDashboard.tsx` 상단 import 블록에 추가:

```typescript
import BulkImportPanel from '@/components/listing/BulkImportPanel';
```

- [ ] **Step 2: 탭 정의에 "대량 등록" 추가**

`ListingDashboard.tsx`에서 탭 목록이 정의된 부분을 찾아 추가합니다 (기존 탭 배열 또는 탭 렌더 로직 위치).

탭 버튼 렌더 영역에 다음을 추가:

```tsx
// 탭 목록 배열에 추가 (기존 탭들 뒤에)
{ id: 'bulk', label: '대량 등록', icon: <Layers size={14} /> }
```

- [ ] **Step 3: 탭 콘텐츠에 BulkImportPanel 렌더**

탭 콘텐츠 스위치 영역에 추가:

```tsx
{activeTab === 'bulk' && <BulkImportPanel />}
```

- [ ] **Step 4: 빌드 확인**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/ListingDashboard.tsx
git commit -m "feat: add 대량 등록 tab to ListingDashboard"
```

---

## Task 5: 동작 검증 (수동 테스트)

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

- [ ] **Step 2: 상품등록 페이지 접속**

`http://localhost:3000/listing` → "대량 등록" 탭 클릭

- [ ] **Step 3: 도매꾹 상품번호 3개 입력 후 "상품 목록 불러오기" 클릭**

도매꾹 임의 상품번호 3개 줄바꿈으로 입력 (예: 실제 도매꾹에서 찾은 번호)

Expected:
- 3개 행이 "대기" 상태로 테이블에 표시

- [ ] **Step 4: "AI 처리 시작" 클릭**

Expected:
- 첫 번째 항목이 "처리 중..." 으로 바뀜
- 완료 후 상품명, 썸네일, 추천가 채워짐
- 상태 "완료" + "등록" 버튼 활성화

- [ ] **Step 5: "등록" 버튼 클릭 (선택 사항 — 실제 API 키 필요)**

Expected: 상태 "등록됨" 으로 변경

- [ ] **Step 6: 최종 커밋**

```bash
git add .
git commit -m "feat: 도매꾹 대량 등록 기능 완성"
```

---

## Self-Review

**Spec Coverage:**
- [x] 도매꾹 상품번호 다수 입력 → ✅ BulkImportPanel textarea
- [x] AI 순차 처리 (썸네일·상세페이지·가격) → ✅ useImportQueue → /prepare API
- [x] 진행 상황 실시간 표시 → ✅ BulkProgressTable (BulkImportPanel 내부)
- [x] 처리 완료 후 플랫폼 등록 → ✅ registerItem → /both API
- [x] 도매꾹 레이트 리밋 방지 → ✅ 1.5초 간격 딜레이
- [x] 기존 seller defaults 재사용 → ✅ STORAGE_KEY 공유

**Placeholders:** 없음

**Type Consistency:**
- `BulkImportItem.id` → `crypto.randomUUID()` ✅
- `ImportItemStatus` → hook·컴포넌트 모두 동일 타입 import ✅
- `/api/listing/both` 응답 필드 (`json.naver?.productNo`, `json.coupang?.productId`) → 기존 API 실제 응답 필드와 일치 필요 (Task 2 Step 1 registerItem에서 확인 필요)

**주의:** `registerItem`의 `/api/listing/both` 요청 body 필드(`thumbnailUrl`, `detailHtml` 등)가 실제 BothRegisterSchema와 완전히 일치하는지 구현 시 확인 필요. 불일치 시 해당 필드 추가.
