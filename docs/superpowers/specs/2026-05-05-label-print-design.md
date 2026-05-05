# 라벨 인쇄 기능 설계

## 개요

쿠팡 소분 판매 제품(세차타월 등 섬유제품)에 붙이는 A4 라벨지를 앱 안에서 편집·인쇄할 수 있는 기능. 한 장에 6칸(2열 × 3행) 구성으로, 왼쪽 열은 상표 이미지, 오른쪽 열은 품질표시 텍스트.

---

## 라벨 규격

| 항목 | 값 |
|---|---|
| 용지 | A4 (210 × 297mm) |
| 칸 구성 | 2열 × 3행 = 6칸 |
| 칸 크기 | 99.1mm × 93mm |
| 상하 여백 | 7mm |
| 좌우 여백 | 5mm |
| 칸 간 가로 간격 | 약 0.9mm |
| 칸 간 세로 간격 | 약 1.3mm |
| 왼쪽 열 (3칸) | 상표 이미지 |
| 오른쪽 열 (3칸) | 품질표시 텍스트 |

---

## 페이지 구조

- **경로:** `/label`
- **진입점:** 리스팅 페이지의 "🏷 라벨 인쇄" 버튼 (`?listingId=xxx` 쿼리파라미터 포함)
- **내비게이션:** 앱 상단 메뉴에 라벨 인쇄 항목 추가

---

## 컴포넌트 구조

```
src/
├── app/label/
│   └── page.tsx                  ← Suspense로 LabelEditor 감싸기
├── components/label/
│   ├── LabelEditor.tsx           ← 좌측 폼 + 우측 미리보기 전체 레이아웃
│   ├── LabelPreview.tsx          ← A4 실제 렌더링 (html2pdf/window.print 대상 ref)
│   ├── LabelImageCell.tsx        ← 상표 이미지 칸
│   ├── LabelTextCell.tsx         ← 품질표시 텍스트 칸
│   ├── QualityFieldsForm.tsx     ← 품질표시 항목 입력 폼
│   └── TemplatePicker.tsx        ← 템플릿 저장/불러오기 드롭다운
└── lib/label/
    ├── label-pdf.ts              ← html2pdf.js 래퍼 (PDF 생성 + 인쇄)
    └── label-templates.ts        ← Supabase CRUD (템플릿 저장/조회/삭제)
```

---

## 데이터 흐름

```
[리스팅 페이지] → "🏷 라벨 인쇄" 클릭
        ↓  /label?productName=세차타월 (품명만 URL 파라미터로 전달)
           (리스팅 스토어는 Zustand 비영속 → 페이지 이동 시 소실. API 연동 불필요)

[LabelEditor] → productName 파라미터 있으면 품명 필드에 자동 채움
               → 없으면 빈 폼 시작

[좌측 폼]
  - 이미지 업로드 → Supabase Storage → image_url 반환
  - 품질표시 입력 → 로컬 state
  - 템플릿 저장 → label_templates 테이블 insert
  - 템플릿 불러오기 → label_templates 조회 → 폼 자동 채움 (이미지 포함)

[LabelPreview] ← 실시간 반영 (state prop 전달)

[PDF 저장] → html2pdf(previewRef.current, { scale:2, unit:'mm', format:'a4', filename:'label.pdf' })
[바로 인쇄] → window.print() + @media print CSS (LabelPreview만 출력)
```

---

## Supabase 스키마

### `label_templates` 테이블

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | FK → auth.users |
| name | text | 템플릿 이름 |
| image_url | text | Supabase Storage 퍼블릭 URL |
| fields | jsonb | 품질표시 항목 (아래 참조) |
| created_at | timestamptz | default now() |

### `fields` JSON 스키마

```json
{
  "productName": "세차타월",
  "material": "극세사 80% / 폴리아미드 20%",
  "size": "40×40cm",
  "country": "중국",
  "importer": "㈜ OOO",
  "address": "서울시 OO구 OO로",
  "phone": "02-000-0000",
  "extra": ""
}
```

---

## 품질표시 입력 항목 (섬유제품 기준)

| 항목 | 필수 여부 |
|---|---|
| 품명 | 필수 |
| 소재/섬유조성 | 필수 |
| 크기/치수 | 필수 |
| 제조국 | 필수 |
| 수입원/판매원 | 필수 |
| 주소 | 필수 |
| 전화번호 | 필수 |
| 기타 (KC인증번호 등) | 선택 |

---

## PDF/인쇄 구현

### 라이브러리
- `html2pdf.js` (클라이언트 사이드, Next.js dynamic import로 SSR 제외)

### PDF 생성 옵션
```ts
{
  margin: [7, 5, 7, 5],   // mm 단위 여백 (상우하좌)
  filename: 'label.pdf',
  image: { type: 'jpeg', quality: 0.98 },
  html2canvas: { scale: 2, useCORS: true },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
}
```

### 인쇄 CSS (`@media print`)
```css
@media print {
  body > * { display: none; }
  #label-preview { display: block !important; }
  @page { margin: 7mm 5mm; size: A4; }
}
```

---

## 리스팅 연동 매핑

리스팅 페이지 → 라벨 페이지 URL 파라미터 전달:

| 전달 방식 | 내용 |
|---|---|
| `?productName=세차타월` | 품명 필드 자동 채움 |
| 나머지 필드 | 수동 입력 또는 저장된 템플릿으로 채움 |

> 현재 리스팅 스토어(Zustand)는 비영속이고, listings DB 테이블이 별도로 없어 URL 파라미터로 품명만 전달하는 방식을 채택. 추후 리스팅 DB 영속화 시 필드 매핑 확장 가능.

---

## 범위 외 (이번 구현에서 제외)

- 다중 상품 일괄 라벨 인쇄 (단일 상품 단위만)
- 커스텀 폰트 선택
- 라벨 칸별 개별 이미지 (3칸 모두 동일 이미지)
- 카테고리별 필드 자동 전환 (섬유제품 고정, 추후 확장 가능)
