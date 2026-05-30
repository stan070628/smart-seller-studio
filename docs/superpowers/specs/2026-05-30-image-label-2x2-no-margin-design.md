---
name: image-label-2x2-no-margin
description: 이미지 라벨 2x2 인쇄 — 여백/간격 완전 제거 및 objectFit cover 수정
metadata:
  type: project
---

# 이미지 라벨 2x2 여백 제거 설계

## 목표

A4 인쇄 후 종이 중앙을 가로/세로 각 1회 절단하면 정확히 4장의 라벨이 되도록, 현재 존재하는 모든 여백과 셀 간격을 제거한다.

## 현재 문제

| 항목 | 값 |
|------|-----|
| 상하 여백 (padding) | 7mm |
| 좌우 여백 (padding) | 5mm |
| 컬럼 간격 | 0.9mm |
| 행 간격 | 4mm |
| 셀 크기 | 99.1mm × 135mm |
| objectFit | contain (전체 이미지 표시, 여백 발생) |
| imagePosition 적용 여부 | 미적용 (버그) — 슬라이더가 시각적으로 동작하지 않음 |

## 변경 사항 (`ImageLabel2x2Preview.tsx`)

### 그리드 레이아웃

```
padding: 0
columnGap: 0
rowGap: 0
CELL_WIDTH_MM: 105   (= 210 / 2)
CELL_HEIGHT_MM: 148.5  (= 297 / 2)
```

### 셀 스타일

- `border` 제거 (절취선 불필요 — 종이 중앙이 절취선)
- `borderRadius` 제거

### 이미지 표시

```
objectFit: cover      (셀 전체를 꽉 채움)
objectPosition: ${imagePosition.x}% ${imagePosition.y}%  (버그 수정)
```

## 범위 외

- 에디터 UI (ImageLabel2x2Editor.tsx) 변경 없음
- 슬라이더 위치 조정 기능 — 이미 존재하므로 버그 수정만

## 인쇄 결과

A4 (210mm × 297mm) → 셀 105mm × 148.5mm × 4개, 여백 0, 종이 정중앙 절단 시 4등분 정확히 일치.
