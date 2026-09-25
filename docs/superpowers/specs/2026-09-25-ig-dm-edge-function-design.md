# 인스타 댓글 키워드 → 자동 DM · Supabase Edge Function 설계

- 작성: 2026-09-25
- 대상 계정: `cheongyeon.corp` (인스타 프로페셔널 계정 · 쿠팡파트너스 라인)
- 선행 결정: 위키 [[인스타 DM 자동화 도구 비교 2026-08-29]]가 「Meta 공식 API만 쓴다」로 판정. 이번 작업은 소셜비즈 대신 공식 Messaging API를 직접 구현한다.

## 1. 목적

릴스·게시물 댓글에 등록된 키워드가 달리면, 그 댓글 작성자에게 상품 링크를 DM(비공개 답장)으로 보낸다. 인스타는 캡션·댓글 링크가 클릭되지 않으므로 DM이 게시물에서 링크까지 가는 유일한 자동 경로다.

## 2. 왜 Edge Function인가

| 조건 | 판단 |
|---|---|
| Vercel을 더 쓰지 않는다 (사용자 결정 2026-09-25) | 어제 만든 Next.js 라우트(`src/app/api/instagram/webhook/route.ts`)는 폐기한다 |
| 웹훅은 공개 HTTPS로 상시 가동돼야 한다 | Supabase Edge Function URL은 고정이고 항상 켜져 있다 |
| 규칙·발송 로그를 남겨 실측해야 한다 | 같은 프로젝트 DB의 `ig_dm_rules`·`ig_dm_log` |
| 프로젝트 | 기존 `Smart.Seller.Studio` (ref `mvergrjqfjuwndveztts`, 서울). 매일 쓰는 프로젝트라 일시정지 위험이 없다. 테이블은 `ig_dm_` 접두어로 분리 |

## 3. 구성

```
supabase/
  functions/ig-webhook/
    index.ts      Deno 진입점. Deno.serve(handle) 와 환경·DB 주입
    handler.ts    handle(req, deps): Request → Response. 순수 Web 표준 API만 사용
    dm.ts         서명 검증·파싱·매칭·문구·발송. 기존 src/lib/instagram/dm.ts 이식
  migrations/106_ig_dm.sql   (이미 작성됨 · 미적용)
src/__tests__/lib/instagram-dm.test.ts   → 새 위치를 import 하도록 경로만 변경 + handler 케이스 추가
```

- `dm.ts`는 Node `crypto` 대신 Web Crypto(`crypto.subtle`)로 HMAC을 계산한다. Node 24(vitest)와 Deno 양쪽에서 같은 코드가 돈다.
- `handler.ts`는 `deps = { env, db, fetch }`를 인자로 받는다. 테스트에서 가짜 DB·fetch를 꽂는다.
- `index.ts`만 Deno 전용이다. 3~10줄.

## 4. 데이터 흐름

1. **GET** `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → 토큰 일치 시 challenge를 text/plain 200으로 반환, 아니면 403.
2. **POST**
   1. 원문 바디로 `X-Hub-Signature-256` 검증. 불일치 → 401.
   2. `object: instagram` / `changes[].field: comments` 이벤트만 추출. 내 계정(`entry.id`)이 단 댓글은 제외.
   3. `ig_dm_rules`에서 `active` 규칙 조회. 매칭 우선순위: 게시물 전용 규칙 > 전체 규칙, 긴 키워드 > 짧은 키워드. 공백 제거·소문자 비교.
   4. `ig_dm_log`에 `comment_id`(PK)로 `pending` 행 선점. PK 충돌(23505)이면 중복 재전송이므로 건너뛴다.
   5. `POST graph.instagram.com/v25.0/{IG_USER_ID}/messages` `{ recipient: { comment_id }, message: { text } }`.
   6. 결과를 `sent`/`failed(error)`로 갱신.
   7. 항상 200으로 응답한다. Meta는 200이 아니면 재전송하는데, 규칙 조회 실패 같은 경우는 재전송돼도 같은 실패라 200으로 끊는다.

**메시지 문구** = `규칙.message`(없으면 "요청하신 상품 링크예요.") + 링크 + 대가성 고지. `link_type=partners`면 쿠팡 파트너스 고지 문구를 반드시 붙인다(공정위·파트너스 운영정책).

## 5. 환경변수 (Supabase secrets)

| 이름 | 출처 |
|---|---|
| `IG_APP_SECRET` | 🔴 **Instagram 앱 시크릿** — 이용 사례 → Instagram API 설정 페이지 상단 「Instagram 앱 시크릿 코드」. 앱 설정 → 기본 설정의 Meta 앱 시크릿이 **아니다** (2026-09-25 실측: Meta 앱 시크릿으로는 `bad-signature`, Instagram 앱 시크릿으로 통과) |
| `IG_VERIFY_TOKEN` | 우리가 정하는 임의 문자열. 웹훅 등록 시 같은 값 입력 |
| `IG_ACCESS_TOKEN` | 대시보드 Instagram → API 설정 → 토큰 생성 (60일) |
| `IG_USER_ID` | 같은 화면의 Instagram 계정 ID |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | Edge Function에 자동 주입 |

⚠️ `supabase secrets set` 뒤에는 **반드시 `functions deploy`를 다시 한다.** 실행 중인 인스턴스는 옛 값을 들고 있어 2026-09-25에 맞는 시크릿을 넣고도 한 차례 실패로 오판했다.

토큰 60일 만료 갱신은 이번 범위 밖이다. 만료일을 위키 프로젝트 문서에 적어두고 수동 갱신한다.

## 6. Meta 설정 절차 (브라우저 · 사용자 로그인 상태에서 진행)

1. developers.facebook.com 개발자 등록 → 앱 만들기 → **Business** 타입.
2. 제품 추가: **Instagram** → 「Instagram API with Instagram Login」 설정.
3. `cheongyeon.corp` 연결 → 토큰 생성 → 계정 ID 기록.
4. 인스타 앱: 설정 → 메시지 및 스토리 답장 → 메시지 관리 → 연결된 도구 → **메시지 접근 허용** 켜기.
5. 웹훅: 콜백 URL `https://mvergrjqfjuwndveztts.supabase.co/functions/v1/ig-webhook`, verify token 입력 → `comments` 구독.
6. `POST /me/subscribed_apps?subscribed_fields=comments` (curl, 토큰으로).
7. 앱 모드 **Live**. 문서가 "웹훅은 Live에서만 온다"고 적는다. 우리 계정만 쓰므로 심사 없는 Standard Access로 충분하다.

## 7. 오류 처리

| 상황 | 처리 |
|---|---|
| 서명 불일치 | 401, 로그 없음 |
| 비밀값 미설정 | 500 + console.error. 배포 후 curl 검증에서 잡힌다 |
| 규칙 조회 실패 | 200 반환, console.error |
| 선점 후 발송 실패 | `failed` + 오류 본문 500자. 재발송하지 않는다 (댓글당 1회 제약) |
| 선점 후 함수 중단 | `pending`으로 남는다. 주기 점검 대상 |
| 7일 지난 댓글 | Meta가 거부 → `failed`로 기록 |

## 8. 테스트 계획

| 단계 | 방법 | 통과 기준 |
|---|---|---|
| 단위 | vitest. 기존 15개 + handler 케이스: 검증 GET 성공·실패, 서명 불일치 401, 정상 흐름 sent, 중복 선점 건너뜀, 발송 실패 기록, 내 댓글 무시 | 전부 통과 |
| 배포 검증 | curl: GET 검증 → challenge / 잘못된 서명 POST → 401 / 올바른 서명 + 가짜 댓글 POST → `ig_dm_log`에 `failed` 행 | 세 가지 모두 |
| 실전 | 규칙 1건 등록 → 다른 계정으로 릴스에 키워드 댓글 | 그 계정에 DM 도착 · 로그 `sent` |

실전 테스트의 댓글 계정은 `cheongyeon.corp`가 아니어야 한다 (자기 댓글은 코드가 거른다). 그 단계에서 사용자에게 확인한다.

## 9. 범위 밖

- 받은 DM 자동 응답 (`messages` 웹훅)
- 규칙 관리 화면 (Supabase 대시보드에서 행 입력)
- 토큰 자동 갱신
- 클릭 추적 (링크 단축·UTM은 규칙의 `link_url`에 직접 넣는다)

## 10. 선행 정리

- `.env.local` 22~29행에 Python 스크립트 조각이 붙어 있어 Supabase CLI가 이 저장소에서 전부 실패한다. `.env.local.bak-20260925`로 백업 후 그 8줄을 제거한다.
- Docker·Deno가 없어 `supabase functions serve`는 불가. 단위 테스트는 vitest, 실행 검증은 배포 URL로 한다.
