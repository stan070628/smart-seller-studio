# 마진 계산기 독립 로컬 프로그램 설계

**날짜:** 2026-06-24  
**범위:** `tools/margin-calculator/` — 메인 프로젝트와 분리된 독립 Vite 앱  
**결과물:** `tools/margin-calculator/dist/index.html` — 단일 HTML 파일

---

## 목표

1688 사입 마진 계산기를 브라우저에서 파일 하나로 열 수 있는 독립 HTML 앱으로 만든다.
서버 불필요. WiFi 환경에서 빌드 한 번 → `dist/index.html` 로컬에서 영구 사용.

---

## 아키텍처

```
tools/margin-calculator/
├── index.html              ← Vite 진입점
├── package.json
├── vite.config.ts          ← vite-plugin-singlefile 설정
├── tsconfig.json
├── postcss.config.ts
├── tailwind.config.ts
├── src/
│   ├── main.tsx            ← ReactDOM.createRoot
│   ├── App.tsx             ← 타이틀 + MarginCalc 래핑
│   ├── lib/
│   │   ├── margin-1688.ts      ← 기존 코드 복사 (무수정)
│   │   └── channel-policy.ts  ← 기존 코드 복사 (무수정)
│   ├── components/
│   │   └── MarginCalc.tsx      ← 기존 코드, 경로·지시문만 수정
│   └── index.css           ← Tailwind directives
└── dist/
    └── index.html          ← 최종 결과물
```

---

## 의존성

| 패키지 | 용도 |
|--------|------|
| `vite` | 번들러 |
| `@vitejs/plugin-react` | JSX/TSX 변환 |
| `vite-plugin-singlefile` | JS/CSS → HTML 인라인 |
| `react` + `react-dom` | UI |
| `typescript` | 타입 체크 |
| `tailwindcss` + `autoprefixer` | 스타일 |

---

## 기존 코드 수정 사항

### `margin-1688.ts`, `channel-policy.ts`
- 수정 없음. 순수 함수만 있어서 그대로 복사.

### `MarginCalc.tsx`
1. `'use client'` 첫 줄 제거
2. `@/lib/sourcing/margin-1688` → `../lib/margin-1688`
3. `@/lib/sourcing/shared/channel-policy` 참조는 `margin-1688.ts` 내부에서 처리되므로 컴포넌트에서 직접 import 없음

---

## 빌드 & 사용

```bash
cd tools/margin-calculator
npm install
npm run build        # → dist/index.html 생성
open dist/index.html # macOS에서 브라우저로 열기
```

`dist/index.html` 파일 하나를 어디든 복사해서 열면 작동.

---

## 범위 외

- 저장/히스토리 기능 (localStorage 등)
- 환율 자동 업데이트 (API 연동)
- 엑셀 내보내기
