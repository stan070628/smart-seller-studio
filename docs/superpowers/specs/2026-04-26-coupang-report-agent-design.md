# 쿠팡 광고 성과 보고서 에이전트 설계

**날짜**: 2026-04-26  
**상태**: 승인됨  
**대상**: `.claude/agents/coupang-report.md`

---

## 개요

Claude Code 서브에이전트로 구현하는 쿠팡 광고 성과 보고서 자동 생성기.  
사용자가 "보고서 생성해줘"라고 말하면 에이전트가 쿠팡 광고 관리자(Ads)와 쿠팡 Wing에 자동 접속해 데이터를 수집하고, Claude Opus 4.6으로 분석 후 HTML과 PDF 보고서를 생성한다.

---

## 아키텍처

### 에이전트 파일

- **위치**: `.claude/agents/coupang-report.md`
- **모델**: `claude-opus-4-6`
- **도구**: Bash (gstack browse `$B` 명령), Read, Write

### 핵심 의존성

- **gstack browse**: `~/.claude/skills/gstack/browse/dist/browse` (alias `$B`)
- **chromium-profile**: `~/.gstack/chromium-profile` — 로그인 세션 쿠키 저장소
- **PDF 생성**: `$B pdf <html_path> --format a4 --print-background --margins 0`

---

## 실행 흐름

### 1단계: 요청 파싱

사용자 요청에서 분석 기간을 추출한다.

| 요청 예시 | 추출 결과 |
|---|---|
| "7일 보고서 생성해줘" | 7일 |
| "이번달 성과 보고서" | 30일 |
| "보고서 만들어줘" (기간 미지정) | 기본값 30일 |

### 2단계: 쿠팡 광고(Ads) 접속

```
$B connect  ← headed Chromium, 저장된 쿠키 로드
$B goto "https://advertising.coupang.com/marketing/dashboard/sales"
$B snapshot -i  ← 페이지 상태 확인
```

**로그인 감지 로직**:
- 스냅샷에 대시보드 요소(캠페인 목록, KPI 숫자) 감지 → 자동 진행
- 로그인 폼 감지 → `$B handoff` 실행 후 "쿠팡 광고 관리자에 로그인 후 '완료'라고 입력해 주세요" 안내 → 사용자 확인 후 `$B resume`

### 3단계: Ads 데이터 수집

수집 대상:

| 지표 | 경로 |
|---|---|
| 노출수, 클릭수, CTR | 대시보드 KPI 영역 |
| 주문수, CVR | 대시보드 KPI 영역 |
| 집행 광고비, 광고 전환 매출, ROAS | 대시보드 KPI 영역 |
| 캠페인별 상세 | 캠페인 목록 테이블 |

수집 방법: `$B snapshot` 텍스트 파싱 + 필요 시 `$B screenshot`으로 시각 데이터 보완.  
기간 필터는 대시보드 날짜 선택기를 `$B click`으로 조작.

### 4단계: 쿠팡 Wing 접속

```
$B goto "https://wing.coupang.com"
$B snapshot -i
```

같은 쿠팡 계정이면 Ads 로그인 후 Wing도 자동 로그인될 수 있으나 보장되지 않음.  
항상 로그인 감지 로직을 실행하고, 로그인 페이지 감지 시 동일한 폴백 로직 적용.

### 5단계: Wing 데이터 수집

수집 대상:

| 데이터 | 경로 |
|---|---|
| 상품 목록 (상품명, 판매가, 재고, 노출상태) | `/vendor-inventory/list` |
| 최근 리뷰 수, 평균 평점 | 리뷰 관리 페이지 |
| 아이템위너 현황 | 상품별 상태 배지 |

### 6단계: Claude Opus 분석

수집된 원시 데이터를 바탕으로 Opus 4.6이 다음 항목을 분석한다:

1. **펀넬 분석**: 노출 → 클릭(CTR) → 주문(CVR) 단계별 이탈 진단
2. **업계 평균 비교**: CTR 업계 평균 0.8~1.5%, CVR 3~8% 기준으로 현황 평가
3. **원인 진단**: 지표 부진의 근본 원인 (이미지, 리뷰, 재고, 아이템위너 등)
4. **액션 플랜**: 긴급(즉시)/단기(1주일)/중기(1개월) 3단계 구분

### 7단계: 보고서 생성 및 저장

**HTML 생성**:
- 파일명: `/tmp/YYYYMMDD_쿠팡_성과보고서.html`
- 스타일: Noto Sans KR, 다크 커버, KPI 카드 그리드, 펀넬 다이어그램, 캠페인 비교, 상품 테이블, 원인 분석 카드, 액션 플랜 3단계
- Google Fonts CDN으로 한글 폰트 로드

**PDF 변환**:
```bash
$B pdf /tmp/YYYYMMDD_쿠팡_성과보고서.html \
  --format a4 --print-background --margins 0
cp /tmp/YYYYMMDD_쿠팡_성과보고서.pdf ~/Desktop/
```

---

## 로그인 폴백 상세

```
navigate(URL)
  ↓
snapshot 분석
  ├─ 대시보드 감지 → 데이터 수집 시작
  └─ 로그인 페이지 감지
       ↓
     $B handoff
       ↓
     사용자: 로그인 후 "완료" 입력
       ↓
     $B resume
       ↓
     snapshot 재확인 → 데이터 수집 시작
```

---

## 출력물

| 파일 | 위치 | 용도 |
|---|---|---|
| `YYYYMMDD_쿠팡_성과보고서.html` | `/tmp/` | 브라우저 미리보기 |
| `YYYYMMDD_쿠팡_성과보고서.pdf` | `~/Desktop/` | 보관/공유 |

---

## 호출 예시

```
"쿠팡 광고 보고서 생성해줘"          → 30일 기본
"7일 보고서 만들어줘"               → 7일
"이번달 성과 보고서 뽑아줘"          → 30일
"지난주 광고 성과 분석해줘"          → 7일
```

---

## 제약 및 전제 조건

- gstack browse가 `~/.claude/skills/gstack/` 에 설치되어 있어야 함
- `~/.gstack/chromium-profile` 에 저장된 쿠키 필요 (최초 실행 시 수동 로그인 1회)
- 로컬 환경 전용 — Vercel 배포 버전에서는 동작하지 않음
- 쿠팡 광고 UI 변경 시 스냅샷 파싱 로직 업데이트 필요할 수 있음
