# YouTube 소싱 영상 Reference Learning Implementation Plan

> **구현 완료** — 2026-05-31. sourcing-calendar 앱에 적용됨.

**Goal:** 사용자가 제작하는 유튜브 소싱 영상을 URL로 입력하면 Claude가 트랜스크립트를 구조화해 소싱 지식 파일로 누적하고, 대분류 추천·소싱 검증 AI 프롬프트에 자동 주입한다.

**Architecture:** `youtube-transcript` 패키지로 자막 추출(API 키 불필요) → Claude Haiku로 구조화 → `data/sourcing-knowledge.json`에 누적 → `buildKnowledgeContext()`가 최근 N개 summary를 텍스트로 변환 → suggest-categories, validate 프롬프트에 주입.

**Tech Stack:** Next.js 15 App Router, TypeScript, `youtube-transcript` npm, `callClaude` (Claude Max Plan CLI), 로컬 JSON 파일 저장

---

## 구현 위치

`sourcing-calendar` 앱 (`~/Desktop/projects/sourcing-calendar/`)

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Create** | `src/lib/learning/transcript.ts` | YouTube URL → 트랜스크립트 텍스트 (한국어 우선) |
| **Create** | `src/lib/learning/structurer.ts` | 트랜스크립트 → Claude 구조화 → `LearnedVideo` JSON + 지식 파일 R/W + `buildKnowledgeContext()` |
| **Create** | `src/app/api/learn/route.ts` | POST: URL → 파이프라인 실행. GET: 지식 목록 반환 |
| **Create** | `src/app/learn/page.tsx` | URL 입력 폼 + 학습된 영상 목록 UI |
| **Modify** | `src/app/api/suggest-categories/route.ts` | `buildBrainstormSystem()`으로 지식 주입 |
| **Modify** | `src/app/api/validate/route.ts` | `buildValidateSystem()`으로 지식 주입 |
| **Create** | `data/sourcing-knowledge.json` | 누적 지식 저장소 (gitignore 적용) |

---

## 지식 파일 포맷

```json
{
  "videos": [
    {
      "id": "YouTube video ID",
      "url": "https://youtube.com/watch?v=...",
      "title": "영상 제목",
      "learnedAt": "ISO 8601",
      "insights": {
        "categories": ["코스트코", "잡화"],
        "tips": ["마진 40% 이상만 진입"],
        "warnings": ["시즌 상품 재입고 불확실"],
        "keyNumbers": { "targetMargin": "40% 이상" },
        "sourcingTiming": "11월~1월 수요 급등 → 9월 소싱"
      },
      "summary": "한 줄 요약 (30자 이내)"
    }
  ]
}
```

---

## 프롬프트 주입 방식

`buildKnowledgeContext(n)` — 최근 n개 영상의 summary만 주입 (전체 JSON 아님):

```
[사용자 소싱 학습 데이터 — 아래 노하우를 추천에 우선 반영하세요]
- [코스트코 소싱 실전 팁] 마진 40% 이상, 셀러 3명 이하가 진입 기준
- [1688 네고 전략] 100개 이상 발주 시 10~15% 가격 협상 가능
```

---

## 사용법

```bash
# 1. 서버 실행
cd ~/Desktop/projects/sourcing-calendar && npm run dev

# 2. http://localhost:3002/learn 접속
# → YouTube URL 입력 → "학습하기" 클릭
# → 자막 추출 → Claude 분석 → 지식 목록 추가 (30초~1분)

# 3. 학습 후 소싱 캘린더에서 "✦ 대분류 AI 추천" 클릭
# → 학습된 노하우가 반영된 추천 결과 확인
```

---

## 다음 단계 (구현 예정)

- 자막 없는 영상 처리: Whisper API 연동 (오디오 → 텍스트)
- 영상 제목 자동 추출: YouTube oEmbed API
- 지식 삭제 API (현재 낙관적 업데이트만)
