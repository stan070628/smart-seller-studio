# 쿠팡 → 네이버·토스 품절 동기화 (2026-09-13)

## 목적
사용자는 쿠팡 Wing 모바일 앱으로만 수량을 관리한다. 네이버·토스는 모바일로 관리할 수 없다.
재고가 모자라면 코스트코에서 더 사 오므로 수량 자체는 엄밀하지 않다. **문제는 코스트코에 물건이 없어 쿠팡을 0으로 내렸는데 네이버·토스에서 계속 팔리는 경우**다.

## 결정 (사용자 답변 반영)
| # | 항목 | 결정 |
|---|---|---|
| 1 | 원장 | 쿠팡. 동기화는 쿠팡 → 네이버·토스 한 방향(A) |
| 2 | 대상 | 쿠팡 **판매자배송(Wing) 옵션만**. 로켓그로스 옵션 제외 |
| 3 | 주기 | 3시간 |
| 4 | 반영 조건 | **쿠팡 수량이 0일 때만** 네이버·토스를 0/품절로 변경. 수량을 맞추지는 않는다 |
| 5 | 실행 위치 | Vercel Hobby라 3시간 cron 불가(2026-09-13 확인) → 로직은 Vercel 경로 `/api/cron/stock-sync`, 호출은 GitHub Actions 스케줄 |
| 6 | 알림 | 텔레그램 `sendTelegramMessage()` |
| 7 | 토스 토큰 | 실행마다 client_credentials로 발급(`TOSS_SHOPPING_ACCESS_KEY/SECRET_KEY`) |

| 8 | 품절 판정 | 쿠팡 `amountInStock === 0` **또는 `onSale === false`(판매중지)** — 2026-09-13 답변 |
| 9 | 복구 | **동기화가 직접 0으로 내린 옵션만** 쿠팡이 다시 판매 가능해지면 쿠팡 수량으로 되살린다. 사용자가 직접 내린 것·기존 불일치는 되살리지 않고 보고만 — 2026-09-13 답변 |

## 확인 대기
| # | 질문 | 근거 |
|---|---|---|
| Q3 | 현재 어긋난 7개 상품을 즉시 0으로 내릴 것인가 | 덴프스 트루다이어트·도미나스(네이버)·예일 후드(토스)·커클랜드 흰티·캘빈클라인 박서·랩노쉬(네이버)·비지트인뉴욕(토스) |

## 진행 (2026-09-13)
| 단계 | 상태 |
|---|---|
| 판정 로직 `src/lib/stock-sync/plan.ts` + 테스트 11개 | ✅ |
| 채널 어댑터 `channels.ts` · 실행기 `run.ts` · 경로 `/api/cron/stock-sync` · `.github/workflows/stock-sync.yml` | ✅ 작성 |
| 마이그레이션 `105_stock_sync_links.sql` | 작성, **미적용** |
| 연결 후보 163건(채널 옵션 151) — scratchpad `links.json` | ✅ 생성, 로컬 드라이런 통과(53초, 오류 0) |
| 토스 `productItemId` = `stocks[].id`인지 `itemId`인지 | ⏳ 같은 값 재설정으로 확인 필요 (쓰기 승인 대기) |
| Vercel env `TOSS_SHOPPING_ACCESS_KEY`·`TOSS_SHOPPING_SECRET_KEY`·`STOCK_SYNC_TELEGRAM_CHAT_ID` | ❌ 없음 |
| GitHub secrets `APP_URL`·`CRON_SECRET` | ❌ 없음 |

추가 결정(구현 중):
- 채널 옵션 하나에 쿠팡 옵션 여럿이 붙을 수 있다(네이버 단일상품 ↔ 쿠팡 M·L). **전부 판매 불가일 때만** 품절, 되살림 수량은 판매 가능 옵션 합
- 채널에서 이미 판매중지(네이버 SALE 아님 / 토스 검수 미통과·숨김)인 상품은 건드리지 않는다
- 제외: 마크곤잘레스 외 쿠팡 Wing 없는 상품, 코오롱 카키 L(쿠팡 옵션 없음)
- 알려진 한계: 네이버 옵션상품의 **추가금 0원 옵션이 전부 품절**이면 저장이 거부된다 → 오류 알림으로 수동 판매중지. 드라이런에서 랩노쉬가 해당

## 구현 메모
- 네이버: origin-product 전체 GET → `optionCombinations[].stockQuantity`만 수정 → 전체 PUT. 0원 옵션 중 재고>0 옵션이 1개 이상 남아야 한다(`scripts/_zz_nv_stock0.mjs`). 단일상품은 `stockQuantity`
- 토스: 상품 GET → `stocks[].remainingCount=0, isSoldOut=true` → 전체 PUT. 대표가(`isMainPrice`) 옵션은 품절 불가(`scripts/_zz_toss_stock0.mjs`)
- 네이버 상세 조회는 연속 호출 시 429 → 700ms 간격 + 재시도
- 매핑: 옵션명이 채널마다 달라(`105(L) 블랙` / `105(L)` / `그레이 / 105(L) / 1개`) 자동 매칭 불가 → 1회 매핑표를 만들어 DB 저장
- 조회 스크립트: `scripts/_stocksync_inventory.ts` → `/tmp/stocksync_inventory.json`
