# 소싱탭 → 대량등록탭 연결 기능 설계

**날짜:** 2026-04-22  
**상태:** 승인됨

---

## 개요

소싱탭(도매꾹)에서 발견한 상품을 상품등록탭 대량등록 큐로 직접 넘기는 기능. 현재는 소싱탭에서 상품번호를 메모한 뒤 등록탭 textarea에 수동 입력해야 하는 갭이 존재한다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 선택 UX | 체크박스 + 하단 버튼 |
| 큐 동작 | 기존 큐에 추가(append), 중복 건너뜀 |
| 탭 전환 | 자동 전환 없음, 토스트 + 바로가기 버튼 |
| 상태 공유 | `useListingStore`에 `pendingBulkItems` 필드 추가 |

---

## 아키텍처

### 상태 공유

`useListingStore`에 다음 필드와 액션 추가:

```typescript
// 상태
pendingBulkItems: string[]   // 소싱탭이 채워놓은 상품번호 목록

// 액션
addPendingBulkItems(itemNos: string[]): void
  // 중복 제거 후 기존 pendingBulkItems에 append
  // 실제 추가된 개수 반환

clearPendingBulkItems(): void
```

별도 스토어나 URL params 없이 기존 스토어 확장으로 해결.

---

## UI 변경 사항

### DomeggookTab.tsx

1. **체크박스 컬럼**
   - 테이블 첫 번째 컬럼 (width: 36px)
   - 헤더 체크박스: 전체선택/해제 토글
   - 로컬 상태: `selectedItemNos: Set<string>`

2. **"N개 상품 대량등록" 버튼**
   - 필터바 오른쪽 끝에 위치
   - `selectedItemNos.size === 0`이면 비활성화(disabled)
   - 텍스트: `{n}개 상품 대량등록`

3. **토스트 알림**
   - 버튼 클릭 시 우상단에 표시
   - 내용: `{실제 추가된 수}개 추가됨` + `등록탭 바로가기 →` 버튼
   - 3초 후 자동 소멸
   - 추가된 수가 0이면 "모두 이미 큐에 있는 상품입니다" 표시
   - 클릭 후 체크박스 전체 해제

### BulkImportPanel.tsx

- `listingMode`가 `'bulk'`로 전환될 때 `pendingBulkItems` 확인
- 있으면 기존 큐 + pendingBulkItems 합쳐서 `initQueue()` 재호출
- 이후 `clearPendingBulkItems()` 호출
- 큐가 이미 `initialized` 상태면 기존 items에 신규 항목만 push (중복 제거)

### useImportQueue.ts

- `appendItems(itemNos: string[])` 액션 추가
  - 기존 큐가 initialized 상태일 때 신규 항목을 pending 상태로 추가
  - 이미 있는 번호는 건너뜀

---

## 데이터 흐름

```
[소싱탭 - DomeggookTab]
1. 체크박스로 상품 선택
2. "3개 상품 대량등록" 버튼 클릭
3. useListingStore.addPendingBulkItems(['12345678', '55667788', '99001122'])
   → 중복 제거, 실제 추가 수 반환
4. 토스트: "{n}개 추가됨 · 등록탭 바로가기 →"
5. 체크박스 전체 해제

[등록탭 - BulkImportPanel]
6. listingMode가 'bulk'로 전환될 때
7. pendingBulkItems.length > 0 이면
   → 큐 미초기화 상태: initQueue(pendingBulkItems)
   → 큐 초기화 상태: appendItems(pendingBulkItems)
8. clearPendingBulkItems()
9. 이후 흐름 기존과 동일
```

---

## 중복 처리 규칙

- `addPendingBulkItems`: pendingBulkItems 내 중복 + 기존 pendingBulkItems와 중복 모두 제거
- `appendItems`: 큐에 이미 있는 번호(어떤 상태든) 건너뜀
- 토스트는 실제 추가된 개수만 표시

---

## 변경 범위

| 파일 | 변경 유형 |
|------|---------|
| `src/store/useListingStore.ts` | `pendingBulkItems` 상태 + 2개 액션 추가 |
| `src/hooks/useImportQueue.ts` | `appendItems()` 액션 추가 |
| `src/components/listing/BulkImportPanel.tsx` | 마운트 시 pendingBulkItems 처리 |
| `src/components/sourcing/DomeggookTab.tsx` | 체크박스 컬럼 + 버튼 + 토스트 |

**변경하지 않는 것:** Step1~3 워크플로우, 등록 API, 소싱 API, 기존 큐 처리 로직

---

## 비범위

- 소싱탭 → 단건 등록(DomeggookPreparePanel) 연결은 이번 범위 외
- 코스트코탭 등 다른 소싱 탭에서의 연결은 이번 범위 외
