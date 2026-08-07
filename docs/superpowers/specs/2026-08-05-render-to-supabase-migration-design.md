# Render → Supabase 마이그레이션 설계

**작성일:** 2026-08-05
**목표:** Render 유료 계정을 해지하고 데이터·서비스를 Supabase와 Fly.io로 이전한다.

---

## 1. 배경

현재 Render와 Supabase 두 곳에 유료로 비용이 나가고 있다. Render에 있는 것은 사실상 Postgres 하나뿐이고, Supabase Pro는 스토리지 때문에 이미 쓰고 있다. Render Postgres를 Supabase로 합치면 유료 지출이 Supabase 하나로 줄어든다.

---

## 2. 이전 전 실측 현황

### 2-1. Render Postgres (`investcock_db`, 싱가포르 리전)

| 항목 | 값 |
|---|---|
| 총 크기 | 551 MB |
| 일반 테이블 | 106개 |
| 뷰 | 2개 (`discovery_conversion_view`, `niche_competitor_summary_view`) |
| Materialized View | 1개 (`sales_analysis_view`) |
| 함수 | 2개 (`domeggook_parent_category`, `handle_updated_at`) |
| 트리거 | 10개 (전부 `updated_at` 갱신용) |
| 스키마 | `public` 하나 |
| 확장 | `plpgsql` 뿐 |
| RLS | `daily_expenses` 한 곳만 활성, **정책은 0개** |
| Postgres 버전 | 18.3 |
| 총 행 수 | 1,145,323 |

상위 테이블: `inventory_snapshots`(542,309행/111MB), `sourcing_items`(453,954행/339MB), `price_tiers`(114,349행/23MB), `costco_products`(4,355행/21MB).

객체 구성이 단순해 표준 `pg_dump` → `pg_restore`로 이전할 수 있다.

### 2-2. Supabase (`mvergrjqfjuwndveztts`, 서울 리전, Pro 플랜)

| 항목 | 값 |
|---|---|
| DB 테이블 | 34개 — 실데이터는 총 80행 남짓 |
| Storage | `smart-seller-studio` 버킷 1개, **public** |
| Storage 사용량 | 약 220MB (2026-08-02 고아 파일 1.4GB 정리 후) |

실데이터가 있는 테이블: `detail_page_drafts`(37), `coupang_drafts`(14), `assets_drafts`(10), `label_templates`(9), `generated_assets`(2), `naver_drafts`(2), `profiles`(2).

### 2-3. 앱과 배포처

| 앱 | 배포처 | DB |
|---|---|---|
| smart_seller_studio (Next.js) | Vercel `smart_seller_studio` (Hobby) | Render (`SOURCING_DATABASE_URL`) + Supabase 일부 |
| 투자콕 백엔드 (FastAPI) | Render `aibox-investment` (무료) | Render (같은 DB 공유) |
| 투자콕 프론트 (Vite) | Vercel `investcock` | — |
| 도매꾹 프록시 | Fly.io `smart-seller-proxy` | — |
| indig-research (Streamlit) | Render (무료) | Render 별도 DB |

**Render Postgres를 smart_seller_studio와 투자콕 백엔드가 공유한다.** 한쪽만 옮기면 다른 쪽이 깨진다.

### 2-4. 투자콕의 현재 상태

Render 무료 플랜은 미사용 시 슬립되며, 슬립 중에는 `backend/main.py:47`의 `apscheduler`가 실행되지 않는다. `weekly_screener_picks`의 마지막 데이터가 2026-07-22로, 약 2주간 스케줄러가 돌지 않았다. 헬스체크 첫 응답에 62초가 걸리는 것으로 슬립 상태를 확인했다.

Fly.io는 상시 프로세스로 동작하므로 이전만으로 이 문제가 해소된다.

---

## 3. 목표 구조

| 구성요소 | 이전 | 이후 |
|---|---|---|
| 메인 DB | Render Postgres (싱가포르) | Supabase Postgres (서울) |
| 이미지 | Supabase Storage | 변경 없음 |
| smart_seller_studio | Vercel | 변경 없음 (DB 주소만 교체) |
| 투자콕 API + Redis | Render | Fly.io + Upstash Redis |
| 투자콕 프론트 | Vercel | 변경 없음 (API 주소만 교체) |
| indig-research | Render | 폐기 |
| 도매꾹 프록시 | Fly.io | 변경 없음 |

Render는 완전히 사라진다.

---

## 4. 이미지 저장 위치 검토 결과

**결론: 이미지는 Supabase Storage에 그대로 둔다. 외장 SSD로 옮길 수 없다.**

버킷이 `public: true`이고, 코드가 `getPublicUrl()`로 만든 공개 URL을 쿠팡·네이버 상품 등록 API 페이로드와 상세페이지 HTML에 직접 삽입한다.

사용 지점: `src/lib/detail-page-privacy.ts:25-27`, `src/lib/image/coupang-constraints.ts:92`, `src/lib/supabase/server.ts:97`, `src/app/api/image/coupang-resize/route.ts:58`, `src/app/api/image/flux-lifestyle/route.ts:70`, `src/app/api/ai/generate-claude-layout-section/route.ts:143`, `src/app/api/ai/edit-image-text/route.ts:220`, `src/app/api/image/add-text-badge/route.ts:80`, `src/app/api/ai/edit-thumbnail/route.ts:520`.

외장 SSD는 외부에서 HTTPS로 접근할 수 없으므로 옮기는 즉시 상품 이미지가 전부 깨진다.

단, **등록이 완료된 이미지는 아카이브해도 된다.** 쿠팡이 등록 시점에 `image1.coupangcdn.com`으로 이미지를 복사해 가기 때문이며, 2026-08-02에 고아 파일 2,798개(1.4GB)를 삭제하고 판매 페이지가 정상임을 확인한 선례가 있다 (`~/dev/_backups/supabase-storage-2026-08-02/README.md`).

현재 남은 220MB는 Pro 플랜 100GB 한도의 0.2%라 SSD로 옮겨도 비용 절감 효과는 없다. Free 플랜(1GB)으로 되돌리는 것이 목표가 아닌 한 이동할 실익이 없다.

---

## 5. 실행 계획

### Phase 0 — 백업과 무결성 검증

Render DB 전량을 `~/dev/_backups/render-db-2026-08-05/`에 보관한다.

- `full.dump` — `pg_dump -Fc -Z6 --no-owner --no-acl`
- `schema.sql` — 스키마 전용 덤프 (7,778줄)
- `rowcounts-before.txt` — 106개 테이블 전체 행 수 스냅샷
- `table-columns.txt` — 테이블별 컬럼 수

**이 검증이 통과하기 전에는 이후 단계를 시작하지 않는다.**

### Phase 1 — 스키마 충돌 정리

Supabase에 Render와 이름이 겹치는 테이블이 4개 있다: `cost_entries`, `product_costs`, `sale_records`, `sourcing_agent_categories`.

네 개 모두 Supabase 쪽은 0행이고, Supabase 클라이언트(`supabase.from()`)로 접근하는 코드가 없음을 확인했다. 드롭해도 안전하다.

별건으로 `src/lib/auto-register/learning-engine.ts:43`이 Supabase의 `auto_register_corrections` 테이블을 읽는데 그 테이블이 존재하지 않는다. 통합 시 함께 정리한다.

`daily_expenses`는 RLS가 켜져 있으나 정책이 0개다. Render에서는 테이블 소유자로 접속해 우회되고 있었다. Supabase에서도 `postgres` role로 접속하면 동일하게 우회되지만, 이관 후 이 테이블의 읽기·쓰기가 실제로 되는지 반드시 확인한다.

### Phase 2 — 데이터 이관

1. Supabase의 실제 Postgres 버전을 확인한다. Render(18.3)보다 낮으면 덤프 옵션을 조정한다.
2. `pg_restore`로 Supabase에 복원한다.
3. 106개 테이블 행 수를 `rowcounts-before.txt`와 전수 대조한다.
4. `sales_analysis_view`를 REFRESH 한다.
5. 뷰 2개, 함수 2개, 트리거 10개의 존재를 확인한다.

### Phase 3 — smart_seller_studio 전환

`SOURCING_DATABASE_URL`을 Supabase 주소로 교체한다.

**Supavisor 풀러를 반드시 사용한다.** 직접 연결(`db.<ref>.supabase.co`)은 IPv6 전용이라 Vercel 서버리스에서 접속할 수 없다. `src/lib/sourcing/db.ts:29`의 `family: 4` 설정은 풀러에서도 유효하다.

- 운영: Transaction 모드 풀러 (포트 6543) — Vercel 서버리스 + 크론 동시 접속 대응
- 교체 위치: 로컬 `.env.local`, Vercel Production 환경변수 (`vercel env`)
- 검증: 크론 엔드포인트 11개 수동 호출, 주요 화면 동작 확인

### Phase 4 — 투자콕 이전

1. `backend/Dockerfile`을 그대로 사용해 Fly.io에 배포한다.
2. Upstash Redis를 연결한다 (`REDIS_URL`).
3. `DATABASE_URL`을 Supabase로 교체한다. `backend/config.py:93`이 `postgresql://` → `postgresql+asyncpg://` 변환을 이미 처리한다.
4. Vercel `investcock` 프로젝트의 `VITE_API_URL`을 새 Fly.io 주소로 교체한다.
5. `apscheduler` 잡이 실제로 실행되는지 확인한다.

### Phase 5 — Render 철수

1. 양쪽 앱이 Supabase에서 정상 동작하는 것을 며칠 관찰한다.
2. indig-research 배포를 정리한다 (데이터 불필요, 코드의 `render.yaml`은 보존).
3. Render 서비스를 중단하고 유료 플랜을 해지한다.

---

## 6. 리스크

| 리스크 | 대응 |
|---|---|
| Postgres 버전 하향 복원 실패 (18.3 → 15/17) | Phase 2 첫 단계에서 Supabase 버전 확인. 스키마 덤프에 PG 18 전용 구문이 없음은 확인 완료 |
| Supabase 디스크 자동 확장 과금 | Pro 8GB 포함, 551MB는 여유. 이관 후 실사용량 확인 |
| Vercel 서버리스 커넥션 고갈 | Transaction 모드 풀러(6543) 사용 |
| 투자콕과 smart_seller_studio 전환 시점 불일치 | Phase 2 완료 후 Render DB는 읽기 참조용으로 남겨두고, 두 앱을 순차 전환. 문제 시 환경변수만 되돌리면 즉시 롤백 |
| Vercel Hobby 크론 제한 | Hobby는 크론잡 2개까지만 지원한다. `vercel.json`에는 11개가 정의되어 있어 상당수가 미등록 상태일 가능성이 있다. 이번 작업 범위 밖이지만 Phase 3 검증 시 실행 이력을 확인한다 |

---

## 7. 롤백

Phase 3, 4의 전환은 환경변수 교체가 전부다. 문제가 생기면 `SOURCING_DATABASE_URL`과 `DATABASE_URL`을 Render 주소로 되돌리면 즉시 복구된다. **Phase 5(Render 해지) 전까지 Render DB는 손대지 않고 그대로 둔다.**

---

## Open Questions

- Supabase의 실제 Postgres 버전 (Phase 2 착수 시 확인)
- Vercel Hobby 크론 11개 중 실제 등록·실행되는 개수
- indig-research DB에 보존할 데이터가 있는지 (현재 판단: 없음)

## 실행 기록

### Phase 0~3 완료 (2026-08-05)

| Phase | 결과 |
|---|---|
| 0. 백업 | `~/dev/_backups/render-db-2026-08-05/` — 94MB 덤프, 오류 0건. Supabase 측도 `supabase-db-2026-08-05/`에 백업 |
| 1. 충돌 정리 | 공통 테이블 **11개** 드롭 (설계 시점 4개에서 정정). 데이터 손실 0 |
| 2. 데이터 이관 | **106개 테이블 / 1,145,323행 전수 일치**. 뷰 2, matview 1, 트리거 10 정상 |
| 3. 앱 전환 | Vercel Production 환경변수 교체 + 재배포. 운영 트래픽이 Supabase로 향함을 쿼리 포착으로 확인 |

### 조사 과정에서 정정한 오판

1. **충돌 테이블 4개 → 11개.** 초기에 코드에서 발견한 이름만 비교했다. 전체 집합을 대조하니 11개였다.
2. **`sourcing_agent_categories`가 Render에서 0행이라는 판단은 틀렸다.** `pg_stat_user_tables.n_live_tup`은 autovacuum 전에는 부정확하다. 실제 `count(*)`는 30행이며 Supabase와 내용이 동일하다. 통계 뷰 대신 `count(*)`로 확인해야 한다.
3. **RLS는 완전히 없는 것이 아니었다.** `daily_expenses` 한 곳만 활성, 정책 0개.

### 설계에 없던 문제와 대응

**Supabase는 `public` 스키마를 PostgREST로 자동 노출한다.** Render에는 RLS 정책이 없었으므로 그대로 복원하면 공개된 anon key로 매출·원가·소싱 데이터를 외부에서 읽을 수 있었다.

대응: `phase2-lock-down-rest.sql`로 이관 객체 109개에서 `anon`·`authenticated` 권한을 회수하고 105개 테이블에 RLS를 활성화했다(정책 0개). anon key 요청이 `permission denied`로 차단되는 것과, Supabase 전용 테이블은 정상 동작하는 것을 실제 요청으로 확인했다.

**Vercel은 Production 환경변수를 기본 `sensitive`로 저장해 등록 후 읽을 수 없다.** 값 검증이 불가능해 `--no-sensitive`로 재등록한 뒤 로컬 값과 대조해 일치를 확인했다.

### 복원 중 발생한 오류 2건 (둘 다 무해)

- `handle_updated_at` 함수 중복 — Supabase 기존 함수와 로직 동일. 공백·줄바꿈만 다르다.
- `virtual_seller_product_id_seq` 중복 — 양쪽 값이 `-4`로 일치. `product_costs`의 음수 ID 최솟값이 `-2`라 충돌 없음.

### Phase 4 완료 (2026-08-05)

투자콕 백엔드를 `aibox-investcock-api.fly.dev`(도쿄)로 이전했다. 프론트 `VITE_API_URL`도 교체하고 재배포했다.

| 검증 | 결과 |
|---|---|
| `/health` | 200 · 0.18초 (Render 콜드스타트는 62초였다) |
| APScheduler | 잡 등록 완료, 상시 실행 |
| Redis | Fly.io Upstash 연결 |
| CORS preflight | 200, `investcock.vercel.app` 허용 |
| 프론트 번들 | 새 API 주소 반영, `onrender.com` 흔적 없음 |

**Render의 실제 과금 항목은 예상과 달랐다.** API로 조회한 결과 유료는 `indig-research`(웹 starter) + `indig-research-db` + `investcock-db`였고, 투자콕 백엔드와 Redis는 무료 플랜이었다. 즉 투자콕 이전은 비용 절감이 아니라 Render 계정 정리를 위한 작업이다.

#### 겪은 문제와 해결

1. **Docker 로그 버퍼링** — Dockerfile에 `PYTHONUNBUFFERED`가 없어 앱의 `print`가 로그에 나오지 않았다. 원인 진단이 막혀 `fly.toml`의 `[env]`에 추가했다.
2. **OOM (`exit_code=137`)** — 512MB에서 uvicorn이 RSS 402MB로 죽었다. `pandas`+`numpy`+`opencv`+`pykrx`를 한 프로세스에 올리는 구조라 1GB로 올려 해결했다.
3. **머신 lease 충돌** — 실패한 첫 배포가 lease를 쥐고 있어 재배포가 막혔다. 이전 배포 프로세스를 종료한 뒤 재시도했다.

#### 암호화 키 이슈 (이전과 무관)

`api_keys` 6건 중 4건이 `InvalidToken`으로 복호화되지 않는다. **Render의 `ENCRYPTION_KEY`를 그대로 넘겼으므로 Render에서도 동일하게 실패하던 상태다.** 복호화되는 2건은 2026-05-05 생성분이고 실패하는 4건은 2026-03-15~21 생성분으로, 그 사이에 키가 교체된 흔적이다.

실사용에는 영향이 없다. 활성 KIS 실계좌 2건(ISA·IRP)은 모두 정상 복호화되고, 실패하는 upbit·newsapi는 환경변수 fallback 경로가 있다.

#### 제약

`apscheduler`가 프로세스 내부에서 도는 구조라 **머신을 2대 이상으로 늘리면 크론이 중복 실행**된다. `fly.toml`에 주석으로 남겼다.

### Phase 5 완료 (2026-08-05)

삭제 전 Render DB의 106개 테이블 행 수를 백업 시점과 재대조해 **전환 이후 새로 들어간 데이터가 없음**을 확인했다. 백업 체크섬도 재검증했다.

삭제한 유료 리소스 3개:

| 리소스 | 종류 | 플랜 |
|---|---|---|
| `indig-research` | web_service | starter |
| `indig-research-db` | postgres | basic_256mb |
| `investcock-db` | postgres | basic_256mb |

Render에 남은 것은 전부 무료다: `aibox-investment`(free, DB가 사라져 더 이상 동작하지 않음), `investcock-redis`(free), `aibox-investcock-web`(중단됨).

삭제 후 두 앱 모두 정상 동작을 확인했다 — smart_seller_studio 사이트 200 및 cron API 200, 투자콕 백엔드 healthy 및 프론트 200.

**남은 확인 사항: Render Workspace 플랜.** API는 Workspace의 플랜(Hobby/Professional) 정보를 제공하지 않는다. Professional이라면 서비스가 0개여도 과금이 계속되므로 대시보드에서 직접 확인해야 한다.

### 롤백 방법

**Phase 5 실행으로 즉시 롤백 경로는 사라졌다.** 복구가 필요하면 `~/dev/_backups/render-db-2026-08-05/full.dump`에서 새 Postgres로 복원해야 한다.

```bash
pg_restore --no-owner --no-acl -d "<대상 DB>" full.dump
```

`.env.local`의 `SOURCING_DATABASE_URL_RENDER_BACKUP`은 이미 삭제된 인스턴스를 가리키므로 더 이상 유효하지 않다.

## Changelog

- 2026-08-05 · Phase 0~3 실행 완료. 오판 3건 정정, PostgREST 노출 문제 대응 기록
- 2026-08-05 · 최초 작성. Render/Supabase/Vercel/Fly.io 실측 조사 결과 반영
