# 전략 v2 확장 — 11개 신규 기능 설계

**작성일**: 2026-04-28
**상태**: 확정
**근거**: 돈버는하마 채널 26편 영상 분석 (`2026-04-27-seller-strategy-v2-design.md` §10) 미반영 영역
**선행 spec**: `2026-04-27-seller-strategy-v2-design.md` (전략 v2)

---

## 1. 목표

전략 v2의 핵심 4개 기능(safety-blocklist, trademark-precheck, sourcing-checklist, margin-calculator) 통합 완료 후, 채널이 강조했지만 미반영된 **11개 영역**을 자동화하여 셀러 운영 부담을 절감하고 매출 1,000만원 달성을 가속한다.

### 결정 요약

| 항목 | 값 |
|---|---|
| 신규 기능 수 | 11 |
| 카테고리 그룹 | 5 (운영자동화 / 위너관리 / 사입의사결정 / 회고학습 / 리뷰관리) |
| spec 단위 | 단일 spec (본 문서) |
| plan 단위 | 5 (카테고리별) |
| 알림 채널 | 이메일 다이제스트 + 인앱 배지 |
| 우선순위 | P0(Week 4 전): 위너관리 / P1(Week 6 전): 운영자동화 / P2(Week 8 전): 사입의사결정 + 회고학습 + 리뷰 |

---

## 2. 11개 기능 카탈로그

### A. 운영 자동화 (Plan 1)

**목적**: 매일 모니터링 부담 절감. 쿠팡 윙/네이버스토어 데이터 자동 수집 → 임계값 위반 시 알림.

| # | 기능 | 트리거 | 채널 근거 |
|---|---|---|---|
| 1 | 광고 ROAS 자동 알림 | ROAS 200% 미만 / SKU 단위 / 매일 | "위너 광고 ROAS 350%+" (억대셀러 강연) |
| 2 | 재고 회전 알림 | 안전재고 30일분 미만 / SKU 단위 / 매일 | "품절 페널티 2주" (셀러 인터뷰) |
| 3 | 부정 리뷰 알림 | 별점 4.0 미만 리뷰 발생 / 즉시 (매시간 cron) / 24h 내 응답 권장 | "별점 4.0 미만 즉시 점검" (위너 분리 영상) |

### B. 위너 관리 (Plan 2)

**목적**: 위너 SKU의 노출 점유율 유지 + 경쟁자 추격 대응.

| # | 기능 | 트리거 | 채널 근거 |
|---|---|---|---|
| 4 | 아이템위너 모니터링 | 매일 / 위너 빼앗김 시 즉시 알림 + 옵션 분리 가이드 | 위너 분리 4편 영상 |
| 5 | 위너 SKU 키워드 최적화 | 주간 / 검색 1페이지 진입 못 한 SKU 자동 추출 + 상품명 재구성 제안 | "키워드 찾는법" (2026-03-10) |

### C. 사입 의사결정 지원 (Plan 3)

**목적**: 위탁 → 사입 전환 결정 자동화 + 1688 가격 협상 가이드.

| # | 기능 | 트리거 | 채널 근거 |
|---|---|---|---|
| 6 | 위탁 vs 사입 자동 추천 (배치) | 매주 / margin-calculator를 cron으로 일괄 실행 / 사입 전환 후보 자동 추천 | "100만원으로 시작" + "1688 사입 노하우" |
| 7 | 1688 가격 협상 가이드 | 발주 시 / SKU별 협상 전략 체크리스트 표시 | "1688 가격흥정 팁" (2025-06-22) |

### D. 회고 + 학습 (Plan 4)

**목적**: 매주/매월 운영 데이터 누적 → 다음 분기 spec 작성 입력.

| # | 기능 | 트리거 | 채널 근거 |
|---|---|---|---|
| 8 | 회송 사례 추적 DB | 회송 발생 시 / SKU/셀러/원인별 누적 / 다음 발주 시 자동 경고 | 회송 3편 시리즈 |
| 9 | CS 자동응답 패턴 분석 | 주간 / TOP 5 질문 자동 추출 + 응답 템플릿 제안 | "CS 응대 24시간" (셀러 인터뷰) |
| 10 | 채널별 분배 모니터링 | 매일 / 매출 비중 50/25/25 추적 / 편차 발생 시 광고 재분배 제안 | spec v2 §2.1 |

### E. 리뷰 관리 (Plan 5)

**목적**: 포토리뷰 적립금 이벤트 자동화.

| # | 기능 | 트리거 | 채널 근거 |
|---|---|---|---|
| 11 | 포토리뷰 적립금 자동화 | 매일 / 리뷰 50+ / 100+ 도달 SKU 자동 추적 / 적립금 이벤트 자동 갱신 | "리뷰 100+ 분기점" (억대셀러) |

---

## 3. 카테고리 → Plan 5 분할

| Plan | 파일명 | 우선순위 | 마감 | 신규 기능 |
|---|---|---|---|---|
| 1 | `2026-04-28-ops-automation-alerts.md` | P1 | Week 6 | 1 + 2 + 3 |
| 2 | `2026-04-28-winner-management.md` | P0 | Week 4 | 4 + 5 |
| 3 | `2026-04-28-sourcing-decision-support.md` | P2 | Week 8 | 6 + 7 |
| 4 | `2026-04-28-retro-and-learning.md` | P2 | Week 8 | 8 + 9 + 10 |
| 5 | `2026-04-28-review-incentive-automation.md` | P2 | Week 10 | 11 |

각 plan은 독립적으로 구현 가능하며, plan 2(위너 관리)가 가장 시급(Week 4 위너 선정 시 필요).

---

## 4. 알림 메커니즘 (default)

### 4.1 이메일 다이제스트
- **빈도**: 매일 오전 9시 KST (기존 `trig_01AKhfhFv1Z1137KJRH7aJa4` cron 활용)
- **포함**: 광고 ROAS 미달 / 재고 부족 / 위너 빼앗김 / 부정 리뷰 / 회고 데이터 요약
- **수신**: `stan@aibox.it.kr` (사용자 메모리 기반)

### 4.2 인앱 배지
- 위치: 사이드바 / `/plan` 페이지 / 대시보드
- 표시: 미확인 알림 개수 (빨간 점)
- 클릭 → `/plan/alerts` 페이지에서 상세 확인

### 4.3 즉시 알림 (긴급)
- 부정 리뷰(별점 4.0 미만) / 품절 발생 시 카카오톡 또는 추가 이메일 (옵션, Plan 1에서 결정)

### 4.4 알림 끄기
- `/plan/alerts/settings`에서 카테고리별 ON/OFF 가능
- default: 모두 ON

---

## 5. 데이터 흐름

### 5.1 데이터 소스

| 데이터 | 출처 | 갱신 주기 |
|---|---|---|
| 쿠팡 광고 ROAS | 쿠팡 윙 (기존 `coupang-report-agent`) | 매일 |
| 쿠팡 재고 | 쿠팡 윙 → SKU 잔여 재고 | 매일 |
| 쿠팡 리뷰 | 쿠팡 윙 → 리뷰 모음 | 매시간 |
| 네이버 광고 ROAS | 네이버 검색광고 API | 매일 |
| 네이버 매출 | 네이버 스마트스토어 API | 매일 |
| 도매꾹 가격 | 기존 `domeggook-client` | 매일 (이미 구현) |
| KIPRIS | 기존 `kipris-client` | 위너 발굴 시 (이미 구현) |
| 회송 사례 | 사용자 수동 입력 + `/sourcing/inbound-checklist` 연동 | 회송 발생 시 |
| CS 문의 | 쿠팡 윙 / 네이버 톡톡 (스크래핑) | 주간 |

### 5.2 신규 DB 테이블

| 테이블 | 책임 | Plan |
|---|---|---|
| `alerts` | 모든 알림 누적 (type/severity/sku/triggered_at/read_at) | 1 |
| `winner_history` | 위너 점유율 일별 스냅샷 | 2 |
| `keyword_optimizations` | 위너 SKU별 상품명 재구성 제안 이력 | 2 |
| `sourcing_recommendations` | 위탁 vs 사입 추천 배치 결과 | 3 |
| `negotiation_logs` | 1688 협상 가이드 사용 이력 | 3 |
| `inbound_returns` | 회송 사례 (sku/seller/reason/cost/at) | 4 |
| `cs_inquiries` | CS 문의 패턴 누적 | 4 |
| `channel_distribution` | 채널별 일일 매출 분배 | 4 |
| `review_milestones` | 리뷰 50/100 도달 SKU 트래킹 | 5 |

### 5.3 기존 인프라 재사용

- `safety-blocklist`, `trademark-precheck`, `sourcing-checklist`, `margin-calculator` (전략 v2)
- `winner-dashboard` plan (이미 작성, 미구현) → Plan 2와 통합 구현
- `coupang-report-agent` plan → Plan 1 데이터 수집부에서 활용
- 기존 `legal/` 모듈 → 위너 KIPRIS 자동 검사
- Supabase migrations sequential numbering: 043부터 시작

---

## 6. 신규 페이지 / API

### 6.1 페이지

| 경로 | Plan | 책임 |
|---|---|---|
| `/plan/alerts` | 1 | 알림 센터 (필터 + 읽음 처리) |
| `/plan/alerts/settings` | 1 | 알림 설정 (카테고리별 ON/OFF) |
| `/sourcing/winner-dashboard` | 2 | 위너 SKU 모니터링 (점유율, 키워드 순위) |
| `/sourcing/keyword-optimizer` | 2 | 키워드 재구성 제안 |
| `/sourcing/sourcing-recommendations` | 3 | 위탁 vs 사입 추천 |
| `/sourcing/negotiation-guide` | 3 | 1688 협상 가이드 |
| `/plan/retro` | 4 | 주간/월간 회고 대시보드 (회송 + CS + 분배) |
| `/sourcing/review-incentives` | 5 | 리뷰 적립금 자동화 |

### 6.2 API

| 경로 | Plan | 메소드 | 책임 |
|---|---|---|---|
| `/api/alerts` | 1 | GET / POST / PATCH | 알림 CRUD |
| `/api/alerts/cron` | 1 | GET (cron) | 알림 생성 배치 |
| `/api/winners/check` | 2 | POST | 위너 빼앗김 체크 |
| `/api/winners/keyword-suggest` | 2 | POST | 상품명 재구성 제안 |
| `/api/sourcing/recommendations/cron` | 3 | GET (cron) | 위탁 vs 사입 배치 |
| `/api/sourcing/negotiation` | 3 | GET | 협상 가이드 조회 |
| `/api/retro/inbound-returns` | 4 | POST | 회송 사례 등록 |
| `/api/retro/cs-patterns` | 4 | GET | CS 패턴 분석 |
| `/api/retro/channel-distribution` | 4 | GET | 채널 분배 추이 |
| `/api/reviews/milestones/cron` | 5 | GET (cron) | 리뷰 도달 추적 |

---

## 7. 구현 우선순위 + 일정

### 7.1 Plan 2 (위너 관리) — P0, Week 4 전 완료 필수

이유: Week 4 1688 첫 발주 시점에 위너 점유율 모니터링이 필수. 사입 발주 후 위너 빼앗기면 페널티.

```
Day 1~2: winner_history DB + 위너 점유율 일별 cron
Day 3~4: 키워드 재구성 제안 알고리즘
Day 5: UI 페이지 + 빌드 + 배포
```

### 7.2 Plan 1 (운영 자동화) — P1, Week 6 전 완료

이유: Week 6 그로스 매출 본격화 시점에 광고/재고/리뷰 모니터링 필요.

### 7.3 Plan 3, 4 (사입 의사결정 + 회고/학습) — P2, Week 8 전

이유: Week 7~8에 2차 사입 결정 + 데이터 누적 필요.

### 7.4 Plan 5 (리뷰 관리) — P2, Week 10 전

이유: Week 10 스케일 사입 시점에 리뷰 100+ 위너 확보 가속.

---

## 8. 의존성 + 리스크

### 8.1 외부 의존성

| 항목 | Plan | 위험도 |
|---|---|---|
| 쿠팡 윙 데이터 수집 | 1, 2, 4, 5 | 중간 (스크래핑 변경 시 break) |
| 네이버 검색광고 API | 1 | 낮음 (공식 API) |
| 네이버 스마트스토어 API | 1, 4 | 낮음 |
| 쿠팡 윙 톡톡 (CS) | 4 | 중간 |
| 1688 사이트 (협상 가이드) | 3 | 낮음 (정적 가이드) |

### 8.2 리스크 대응

- **쿠팡 스크래핑 break**: 기존 `coupang-report-agent` 패턴 따라가며, 쿠팡 UI 변경 시 fallback (수동 입력 옵션)
- **알림 노이즈**: default ON이지만 사용자가 즉시 OFF 가능. 첫 1주 운영 후 임계값 재조정
- **데이터 정확성**: 광고/재고는 6시간 시차 가능. 알림 메시지에 "데이터 기준 시각" 명시

---

## 9. 검증 항목

- 11개 신규 기능 모두 plan에서 task로 정의됨
- DB 테이블 9개 마이그레이션 042~051
- 신규 페이지 8개 빌드 성공
- 신규 API 10개 동작 확인
- 알림 다이제스트 이메일 첫 발송 검증
- 인앱 배지 표시 정상

---

## 10. Plan 5개 분할 매핑

각 plan은 독립적으로 구현 가능하며 다음 spec 섹션을 책임:

- **Plan 1** (`ops-automation-alerts`): §2.A + §4 + §6.1 (`/plan/alerts*`) + §6.2 (`/api/alerts*`)
- **Plan 2** (`winner-management`): §2.B + §6.1 (`/sourcing/winner-dashboard`, `/keyword-optimizer`) + §6.2 (`/api/winners*`)
- **Plan 3** (`sourcing-decision-support`): §2.C + §6.1 (`/sourcing/sourcing-recommendations`, `/negotiation-guide`) + §6.2 (`/api/sourcing/recommendations*`, `/negotiation`)
- **Plan 4** (`retro-and-learning`): §2.D + §6.1 (`/plan/retro`) + §6.2 (`/api/retro/*`)
- **Plan 5** (`review-incentive-automation`): §2.E + §6.1 (`/sourcing/review-incentives`) + §6.2 (`/api/reviews/milestones*`)

---

## 11. 다음 단계

1. **본 spec 사용자 검토 후 승인** → 5개 plan 작성 (writing-plans 스킬)
2. **Plan 2(위너관리) 우선 작성** — Week 4 마감 가장 시급
3. **Plan 1(운영자동화) 다음** — Week 6 마감
4. **Plan 3, 4, 5** 병행 가능 (서로 독립)

각 plan 작성 후 우선순위에 따라 sequential 또는 parallel 구현. 이전 v2 패턴(P0~P2 worktree 분할)과 동일.
