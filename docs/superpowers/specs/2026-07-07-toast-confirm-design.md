# alert/confirm → 토스트·확인 다이얼로그 설계

> 작성일: 2026-07-07
> 대상: `src/components/orders/` 6개 파일 + 신규 `ui/toast`·`ui/confirm` + 루트 layout
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §1.3 (B)

## 0. 문제

주문/매출(orders) 컴포넌트가 브라우저 기본 `alert()`(24곳)·`confirm()`(4곳)을 쓴다. 흐름을 끊고, 스타일이 앱과 이질적이며, 테스트·자동화(browse)에서 다이얼로그가 이벤트 루프를 막는다.

| 파일 | alert | confirm |
|---|---|---|
| `SaleEntryPanel.tsx` | 11 | 1 |
| `CostEntryDrawer.tsx` | 5 | 1 |
| `CostManagementTab.tsx` | 5 | 1 |
| `ShippingGroupModal.tsx` | 1 | 0 |
| `AddProductModal.tsx` | 1 | 0 |
| `RocketGrowthShipmentModal.tsx` | 1 | 1 |
| **합** | **24** | **4** |

confirm 4곳은 전부 삭제류(입고/판매/상품 삭제, RG 입고 취소).

## 1. 목표

- `alert` → 토스트, `confirm` → 앱 스타일 확인 다이얼로그로 교체.
- 라이브러리 없이, 호출부 변경 최소로.

**성공 기준:** orders 6개 파일에 `alert(`/`confirm(` 0개. 실패는 빨강 토스트, 성공은 초록 토스트, 삭제는 확인 다이얼로그.

## 2. 토스트 시스템 (`src/components/ui/toast.tsx`)

**모듈 싱글턴 store** — context 대신, 흩어진 호출부(모달 포함)가 import만으로 쓰게:
```ts
type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string; }
// 내부 store: items 배열 + 구독자 Set + nextId
export const toast = {
  success(message: string): void,  // items에 추가 → 구독자 통지 → 3.5초 후 제거
  error(message: string): void,
};
export function Toaster(): JSX.Element;  // store 구독, 우하단 고정 렌더
```
- `Toaster`는 `useSyncExternalStore`(또는 useEffect 구독)로 items를 렌더. 각 토스트 성공=초록/실패=빨강, 3.5초 자동 소멸(+클릭 닫기).
- 우하단 고정(`position: fixed; bottom/right`), 기존 `undoToast`/importResult 패널과 겹치지 않게 `bottom` 오프셋 조정(패널들은 24/84, 토스트는 위로 쌓거나 별도 위치).

## 3. 확인 다이얼로그 (`src/components/ui/confirm.tsx`)

**Promise 기반 싱글턴**:
```ts
interface ConfirmOptions { message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; }
export function confirmDialog(opts: string | ConfirmOptions): Promise<boolean>;
export function ConfirmHost(): JSX.Element;  // 열린 요청 있으면 모달 렌더
```
- `confirmDialog('삭제할까요?')` → store에 pending 등록 → `ConfirmHost`가 모달(확인/취소) 렌더 → 버튼 클릭 시 Promise resolve(true/false) + 모달 닫힘.
- 삭제류는 `danger: true`로 확인 버튼 빨강. 메시지에 줄바꿈(`\n`) 지원(현 confirm 메시지 유지).

## 4. 마운트 (`src/app/layout.tsx`)

`<body>` 안에 `<Toaster/>`·`<ConfirmHost/>`를 children과 함께 1회 렌더 → 앱 전역에서 `toast`/`confirmDialog` 사용 가능.
```tsx
<body className="h-full">
  {children}
  <Toaster />
  <ConfirmHost />
</body>
```

## 5. 호출부 교체 (orders 6개 파일)

- **alert 24곳**: 의미에 따라 `toast.error(msg)`(실패/검증오류) 또는 `toast.success(msg)`(완료). 각 파일 상단에 `import { toast } from '@/components/ui/toast';`.
- **confirm 4곳**: `if (!confirm(msg)) return;` → `if (!(await confirmDialog(msg))) return;`. 감싼 함수는 이미 async(삭제 핸들러); 아니면 `async` 추가. import `{ confirmDialog }`.
- 교체 후 각 파일에서 `alert(`/`confirm(`/`window.confirm` grep 0 확인.

## 6. 테스트

- **toast store 단위 테스트**: `toast.success/error` 호출 시 구독자에 아이템 통지, id 증가, 자동 제거(타이머 fake). 
- **confirm store 단위 테스트**: `confirmDialog` 호출 시 pending 등록, resolve(true)/resolve(false)가 Promise를 올바르게 종료.
- **`<Toaster/>`/`<ConfirmHost/>` 렌더 테스트**: 아이템/pending 있을 때 메시지·버튼 렌더, 버튼 클릭 콜백.
- 28곳 교체는 grep 0 + tsc + 수동 스모크.

## 7. 파일 요약

| 파일 | 변경 |
|---|---|
| `src/components/ui/toast.tsx` | 신규 — store + `toast` + `<Toaster/>` |
| `src/components/ui/confirm.tsx` | 신규 — store + `confirmDialog` + `<ConfirmHost/>` |
| `src/components/ui/index.ts` | export 추가 |
| `src/app/layout.tsx` | `<Toaster/>`·`<ConfirmHost/>` 마운트 |
| orders 6개 파일 | alert→toast, confirm→confirmDialog |
| 테스트 | toast/confirm store + 렌더 |

## 8. 범위 밖

- orders 외 탭(sourcing/editor 등)의 alert — 이번 제외(추후 동일 시스템 재사용).
- 토스트 큐잉/우선순위/액션 버튼(예: undo) — 기본 표시만. 기존 `undoToast`(실행취소)·importResult 패널은 현행 유지(별개 UI).
- i18n·접근성 고급(포커스 트랩 등)은 기본 수준만.

## 9. 리스크

| 리스크 | 완화 |
|---|---|
| 모듈 싱글턴이 SSR/다중 마운트에서 상태 공유 문제 | store는 클라이언트 전용('use client'), `<Toaster/>`/`<ConfirmHost/>`는 루트 1회 마운트. 구독은 마운트 시 |
| confirm 호출 함수가 async 아님 | 해당 함수에 `async` 추가(반환값 안 쓰는 이벤트 핸들러라 안전) |
| 토스트가 기존 하단 패널과 겹침 | `bottom` 오프셋을 기존 패널(24/84) 위로 두거나 상단 배치 |
| 교체 누락 | 파일별 `alert(`/`confirm(` grep 0으로 검증 |
