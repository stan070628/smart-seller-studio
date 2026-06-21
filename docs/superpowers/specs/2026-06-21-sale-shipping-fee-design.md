# 판매 내역 택배비 필드 추가 설계

**날짜:** 2026-06-21  
**범위:** 수익 원가 탭 > 판매 내역 패널

## 목표

판매 내역(`sale_records`)에 택배비(`shipping_fee`) 필드를 추가한다.  
채널이 쿠팡(`coupang`) 또는 네이버(`naver`)인 경우 기본값 3,500원을 자동 설정하며, 수동 수정도 가능하다.

## DB 변경

```sql
-- 컬럼 추가
ALTER TABLE sale_records
  ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0;

-- 기존 레코드 일괄 업데이트
UPDATE sale_records
  SET shipping_fee = 3500
  WHERE channel IN ('coupang', 'naver');
```

- 타입: `INTEGER NOT NULL DEFAULT 0`
- 로켓그로스(`rocket_growth`)와 수동(`manual`) 채널은 0 유지

## API 변경

### GET `/api/cost-management/products/[id]/sales`
- SELECT 쿼리에 `shipping_fee` 컬럼 포함

### POST `/api/cost-management/products/[id]/sales`
- body에서 `shipping_fee` 수신 (없으면 0)
- INSERT 시 `shipping_fee` 저장

### PATCH `/api/cost-management/sales/[id]`
- body에서 `shipping_fee` 수신 가능 (부분 업데이트, COALESCE 방식)
- 유효성: `shipping_fee >= 0` 정수

### POST `/api/cost-management/products/[id]/coupang-import`
- 쿠팡 주문 가져올 때 `shipping_fee = 3500` 자동 저장

## UI 변경 (`SaleEntryPanel.tsx`)

### 인터페이스
```ts
interface SaleRecord {
  // ...기존 필드
  shipping_fee: number;
}

interface SaleForm {
  // ...기존 필드
  shipping_fee: string;
}
```

### 테이블 헤더
`['판매일', '수량', '판매가', '채널', '사이즈', '택배비', '']` — '택배비' 컬럼 추가

### 표시 행
- `shipping_fee > 0`: `₩3,500` 형식으로 표시
- `shipping_fee === 0`: `—` 표시

### 인라인 편집 행 / 새 판매 추가 행
- 택배비 number input 추가 (기본값 0, 직접 입력 가능)

### 새 판매 추가 기본값
- 수동 추가 시 채널이 지정되지 않으므로 택배비 기본값 0
- 사용자가 직접 입력

## 영향 범위

- `sale_records` 테이블 스키마
- `SaleEntryPanel.tsx`
- `GET/POST /products/[id]/sales` API
- `PATCH /sales/[id]` API
- `POST /products/[id]/coupang-import` API
