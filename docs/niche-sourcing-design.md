# 니치소싱 탭 설계서

## 전략

**핵심 관점**: 쿠팡 물류센터에 보관하기 어려운 상품 = 로켓배송 비진출 = 경쟁 약함 = 기회

| 항목 | 설명 |
|------|------|
| 데이터 소스 | 네이버 쇼핑 API (검색 + 자동완성 + 데이터랩) |
| 추천 방식 | cron이 매일 자동 분석 → 사용자는 결과를 바로 확인 |
| 대상 상품 | 업소용 냉장고, 제빙기, 산업용 장비 등 고가/대형 포함 |

---

## 니치점수 (100점 만점)

| # | 요소 | 비중 | 만점 | 설명 |
|---|------|------|------|------|
| 1 | 로켓배송 비진출 추정 | 30% | 30 | 고가/대형/업소용일수록 가산 |
| 2 | 상품수 경쟁도 | 20% | 20 | 100~500개 최적, 3000+ 레드오션 |
| 3 | 판매자 다양성 | 15% | 15 | 고유 판매자 비율 |
| 4 | 독점도 | 10% | 10 | 상위 3 판매자 점유율 낮을수록 좋음 |
| 5 | 브랜드 비율 | 10% | 10 | 무브랜드 비율 높을수록 좋음 |
| 6 | 가격 마진실현성 | 10% | 10 | 너무 저가면 마진 불가, 고가면 좋음 |
| 7 | 국내 희소성 | 5% | 5 | 판매자 수 자체가 적으면 희소 |

### 등급

| 등급 | 점수 | 의미 |
|------|------|------|
| S | 80+ | 강력 추천 |
| A | 65~79 | 유망 |
| B | 50~64 | 보통 |
| C | 35~49 | 주의 |
| D | 34 이하 | 비추 |

---

## 유저 플로우

```
니치소싱 탭 열기
  ↓
추천 키워드 카드 표시 (cron이 미리 분석해둔 결과)
  - 🔥 S등급: 업소용 제빙기 (92점), 산업용 건조기 (88점)...
  - ✅ A등급: 대형 진열대 (76점), 반신욕기 (72점)...
  ↓
키워드 클릭 → 상세 분석 패널
  - 7요소 레이더 차트
  - 시그널 해석 ("로켓배송 진출 가능성 낮음")
  - 가격 분포 + 상위 판매자 목록
  - 점수 변동 추이 (30일)
  ↓
관심 키워드 등록 (★)
```

---

## 추천 키워드 자동 생성 (cron)

매일 06:00 KST 실행:

1. 시드 키워드 로드 (업소용/대형/산업용/특수 카테고리)
2. 네이버 쇼핑 자동완성으로 파생 키워드 확장
3. 각 키워드에 대해 네이버 쇼핑 API 검색 (100건)
4. 데이터 집계 → calculateNicheScore 실행
5. niche_keywords 테이블 UPSERT
6. 신규 S/A 등급 → niche_alerts 테이블 INSERT

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | /api/niche/analyze | 단일 키워드 니치점수 분석 |
| GET | /api/niche/keywords | 추천 키워드 목록 (필터/정렬) |
| POST | /api/niche/watchlist | 관심 키워드 등록 |
| DELETE | /api/niche/watchlist/[id] | 관심 키워드 삭제 |
| GET | /api/niche/watchlist | 관심 키워드 목록 |
| GET | /api/niche/history/[keyword] | 점수 변동 이력 |
| GET | /api/niche/cron | cron 실행 (인증 필요) |

---

## DB 테이블

- `niche_keywords` — 추천 키워드 + 최신 니치점수
- `niche_score_history` — 일별 점수 스냅샷
- `niche_watchlist` — 관심 키워드
- `niche_analyses` — 수동 분석 로그
- `niche_alerts` — 신규 S/A 알림
- `niche_cron_logs` — cron 실행 로그

---

## 컴포넌트 구조

```
src/components/niche/
  NicheTab.tsx              # 탭 루트
  NicheSearchBar.tsx        # 키워드 검색
  NicheKeywordGrid.tsx      # 추천 키워드 카드 그리드
  NicheKeywordCard.tsx      # 개별 카드
  NicheScorePanel.tsx       # 상세 분석
  NicheRadarChart.tsx       # 7요소 레이더 차트
  NicheBreakdownBar.tsx     # 요소별 막대
  NicheSignalList.tsx       # 시그널 해석
  NicheHistoryChart.tsx     # 점수 추이
  NicheWatchlist.tsx        # 관심 키워드
  NicheAlertBadge.tsx       # 알림 배지

src/lib/niche/
  scoring.ts                # calculateNicheScore
  naver-shopping.ts         # 네이버 쇼핑 API
  keyword-signals.ts        # 키워드/카테고리 시그널
  seed-keywords.ts          # 시드 키워드 상수

src/store/useNicheStore.ts  # Zustand 스토어
src/types/niche.ts          # 타입 정의
```

---

## 개발 로드맵

| Phase | 내용 | 기간 |
|-------|------|------|
| 1 | DB 스키마 + 네이버 API 클라이언트 + scoring.ts | 2일 |
| 2 | cron 파이프라인 + 추천 키워드 API + 프론트 기본 UI | 2일 |
| 3 | 상세 분석 패널 + 레이더 차트 + 시그널 | 2일 |
| 4 | 관심 키워드 + 점수 이력 | 1일 |
| 5 | 폴리싱 + cron 운영 + UX 검토 | 1일 |
