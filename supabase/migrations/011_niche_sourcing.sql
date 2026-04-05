-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Niche Sourcing Schema Migration
-- 파일: supabase/migrations/011_niche_sourcing.sql
--
-- 니치소싱 기능을 위한 테이블 6종:
--   1. niche_keywords      — 추천 키워드 마스터 + 최신 니치점수
--   2. niche_score_history — 키워드별 일별 점수 스냅샷
--   3. niche_watchlist     — 관심 키워드 목록
--   4. niche_analyses      — 수동 분석 실행 로그
--   5. niche_alerts        — 신규 S/A 등급 알림
--   6. niche_cron_logs     — cron 실행 로그
--
-- NOTE: Render PostgreSQL 직접 연결 (pg Pool). RLS 미사용.
--       handle_updated_at 함수는 001_initial_schema.sql 에서 이미 생성됨.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. niche_keywords — 추천 키워드 마스터 + 최신 니치점수
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_keywords (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 키워드 식별
  keyword                   text        NOT NULL UNIQUE,
  category_tag              text,                                          -- 시드 카테고리 태그

  -- 종합 점수 (0~100) / 등급
  total_score               smallint    CHECK (total_score BETWEEN 0 AND 100),
  grade                     char(1)     CHECK (grade IN ('S', 'A', 'B', 'C', 'D')),

  -- 요소별 세부 점수
  score_rocket_non_entry    smallint    CHECK (score_rocket_non_entry    BETWEEN 0 AND 30),  -- 로켓 미진입 여부
  score_competition_level   smallint    CHECK (score_competition_level   BETWEEN 0 AND 20),  -- 경쟁 강도
  score_seller_diversity    smallint    CHECK (score_seller_diversity    BETWEEN 0 AND 15),  -- 판매자 다양성
  score_monopoly_level      smallint    CHECK (score_monopoly_level      BETWEEN 0 AND 10),  -- 독점 여부
  score_brand_ratio         smallint    CHECK (score_brand_ratio         BETWEEN 0 AND 10),  -- 브랜드 비율
  score_price_margin        smallint    CHECK (score_price_margin        BETWEEN 0 AND 10),  -- 가격 마진성
  score_domestic_rarity     smallint    CHECK (score_domestic_rarity     BETWEEN 0 AND 5),   -- 국내 희소성

  -- 원시 수집 데이터
  raw_total_products        integer,                                       -- 전체 상품 수
  raw_avg_price             integer,                                       -- 평균 가격 (원)
  raw_median_price          integer,                                       -- 중앙값 가격 (원)
  raw_unique_sellers        integer,                                       -- 고유 판매자 수
  raw_brand_count           integer,                                       -- 브랜드 수
  raw_top3_seller_count     integer,                                       -- 상위 3개 판매자 상품 수
  raw_sample_size           integer,                                       -- 분석 표본 크기

  -- 감지된 신호 목록 (예: ["로켓배송_미진입", "판매자_분산"])
  signals                   jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- 시각
  analyzed_at               timestamptz,                                   -- 마지막 분석 시각
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_keywords                    IS '니치소싱 추천 키워드 마스터. 최신 분석 결과를 보관하며 이력은 niche_score_history 에 적재.';
COMMENT ON COLUMN public.niche_keywords.grade              IS 'S=최우수(90+), A=우수(75+), B=양호(55+), C=보통(35+), D=낮음(<35)';
COMMENT ON COLUMN public.niche_keywords.signals            IS '분석 과정에서 감지된 긍정/부정 신호 배열 (문자열 태그)';
COMMENT ON COLUMN public.niche_keywords.raw_sample_size    IS 'API 호출 시 실제 수집한 상품 표본 수';

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_niche_keywords_updated_at
  BEFORE UPDATE ON public.niche_keywords
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_niche_keywords_grade_score
  ON public.niche_keywords (grade, total_score DESC);           -- 등급별 점수 순 조회

CREATE INDEX IF NOT EXISTS idx_niche_keywords_category_tag
  ON public.niche_keywords (category_tag);                      -- 카테고리 필터

CREATE INDEX IF NOT EXISTS idx_niche_keywords_total_score
  ON public.niche_keywords (total_score DESC);                  -- 전체 점수 내림차순


-- ─────────────────────────────────────────────────────────────────────────
-- 2. niche_score_history — 키워드별 일별 점수 스냅샷
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_score_history (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 키워드 참조 (삭제 시 이력도 함께 제거)
  keyword                   text        NOT NULL
                              REFERENCES public.niche_keywords(keyword) ON DELETE CASCADE,
  snapshot_date             date        NOT NULL,

  -- 해당 날짜의 점수 스냅샷
  total_score               smallint    CHECK (total_score BETWEEN 0 AND 100),
  grade                     char(1)     CHECK (grade IN ('S', 'A', 'B', 'C', 'D')),

  -- 요소별 세부 점수
  score_rocket_non_entry    smallint    CHECK (score_rocket_non_entry    BETWEEN 0 AND 30),
  score_competition_level   smallint    CHECK (score_competition_level   BETWEEN 0 AND 20),
  score_seller_diversity    smallint    CHECK (score_seller_diversity    BETWEEN 0 AND 15),
  score_monopoly_level      smallint    CHECK (score_monopoly_level      BETWEEN 0 AND 10),
  score_brand_ratio         smallint    CHECK (score_brand_ratio         BETWEEN 0 AND 10),
  score_price_margin        smallint    CHECK (score_price_margin        BETWEEN 0 AND 10),
  score_domestic_rarity     smallint    CHECK (score_domestic_rarity     BETWEEN 0 AND 5),

  -- 스냅샷 당시 원시 수집 데이터 (최소 2개 — 추세 분석용)
  raw_total_products        integer,
  raw_avg_price             integer
);

COMMENT ON TABLE  public.niche_score_history              IS '키워드별 일별 니치점수 스냅샷. cron 실행 시마다 적재하여 추세 분석에 사용.';
COMMENT ON COLUMN public.niche_score_history.snapshot_date IS '스냅샷 기준일 (UTC 날짜 기준)';

-- (keyword, snapshot_date) 복합 유니크 — 하루 1회 upsert 보장
CREATE UNIQUE INDEX IF NOT EXISTS uidx_niche_score_history_keyword_date
  ON public.niche_score_history (keyword, snapshot_date);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_niche_score_history_keyword_date
  ON public.niche_score_history (keyword, snapshot_date DESC);  -- 키워드별 최신 이력 조회


-- ─────────────────────────────────────────────────────────────────────────
-- 3. niche_watchlist — 관심 키워드 목록
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_watchlist (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  keyword       text        NOT NULL UNIQUE,                    -- 관심 등록 키워드
  memo          text,                                           -- 사용자 메모
  latest_score  smallint    CHECK (latest_score BETWEEN 0 AND 100),  -- 최신 점수 (비정규화 캐시)
  latest_grade  char(1)     CHECK (latest_grade IN ('S', 'A', 'B', 'C', 'D')),

  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_watchlist              IS '관심 키워드 목록. niche_keywords 와 별도로 관리되어 미분석 키워드도 등록 가능.';
COMMENT ON COLUMN public.niche_watchlist.latest_score IS 'cron 갱신 시 niche_keywords 로부터 동기화되는 비정규화 점수 캐시';


-- ─────────────────────────────────────────────────────────────────────────
-- 4. niche_analyses — 수동 분석 실행 로그
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_analyses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  keyword     text        NOT NULL,                             -- 분석 대상 키워드 (FK 없음 — 삭제 후에도 이력 보존)
  total_score smallint    CHECK (total_score BETWEEN 0 AND 100),
  grade       char(1)     CHECK (grade IN ('S', 'A', 'B', 'C', 'D')),

  -- 분석 결과 상세
  breakdown   jsonb,                                            -- 요소별 점수 상세 {score_rocket_non_entry: 25, ...}
  signals     jsonb,                                            -- 감지된 신호 배열
  raw_data    jsonb,                                            -- API 원시 응답 전체

  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_analyses         IS '수동 분석 API 호출 로그. 동일 키워드를 반복 분석해도 전부 적재.';
COMMENT ON COLUMN public.niche_analyses.raw_data IS '크롤러/외부 API 원시 응답 전체 — 디버깅 및 재분석 용도';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_niche_analyses_keyword_created
  ON public.niche_analyses (keyword, created_at DESC);          -- 키워드별 최신 분석 조회


-- ─────────────────────────────────────────────────────────────────────────
-- 5. niche_alerts — 신규 S/A 등급 알림
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  keyword     text        NOT NULL,                             -- 알림 대상 키워드
  grade       char(1)     NOT NULL CHECK (grade IN ('S', 'A')),  -- S/A 등급만 알림 생성
  total_score smallint    NOT NULL CHECK (total_score BETWEEN 0 AND 100),

  is_read     boolean     NOT NULL DEFAULT false,               -- 읽음 여부

  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_alerts         IS 'cron 실행 후 신규 S/A 등급 키워드 발견 시 생성되는 알림.';
COMMENT ON COLUMN public.niche_alerts.is_read IS 'false=미확인, true=확인 완료';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_niche_alerts_is_read_created
  ON public.niche_alerts (is_read, created_at DESC);            -- 미읽은 알림 최신순 조회


-- ─────────────────────────────────────────────────────────────────────────
-- 6. niche_cron_logs — cron 실행 로그
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_cron_logs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 실행 구간
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,

  -- 실행 결과
  status              text        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'success', 'partial', 'failed')),

  -- 집계 수치
  keywords_analyzed   integer     NOT NULL DEFAULT 0,           -- 분석 시도 키워드 수
  keywords_updated    integer     NOT NULL DEFAULT 0,           -- niche_keywords upsert 성공 수
  new_sa_count        integer     NOT NULL DEFAULT 0,           -- 신규 S/A 등급 발견 수

  -- 실패 상세
  errors              jsonb,                                     -- 실패 항목 [{keyword, error, stack}]

  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_cron_logs                  IS 'niche_keywords 일괄 갱신 cron 실행 이력. 모니터링 및 장애 추적 용도.';
COMMENT ON COLUMN public.niche_cron_logs.status           IS 'running=실행중, success=전체성공, partial=일부실패, failed=전체실패';
COMMENT ON COLUMN public.niche_cron_logs.keywords_analyzed IS '이번 실행에서 분석을 시도한 총 키워드 수';
COMMENT ON COLUMN public.niche_cron_logs.new_sa_count     IS '이번 실행에서 신규로 S 또는 A 등급을 획득한 키워드 수';
COMMENT ON COLUMN public.niche_cron_logs.errors           IS '실패 항목 배열 [{keyword: string, error: string, stack?: string}]';
