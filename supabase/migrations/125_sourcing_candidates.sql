-- 소싱 후보 수집기
-- spec docs/superpowers/specs/2026-09-27-sourcing-candidates-design.md
--
-- 적용: Supabase 대시보드 SQL Editor에서 직접 실행한다.
-- 격리는 RLS가 아니라 라우트의 user_id 조건이다 (앱은 service-role pg 풀 · 영수증 테이블과 같다).
-- 판정(거름망·두 공식)은 저장하지 않는다 — 조회 때 계산한다. 상수가 바뀌면 자동으로 따른다.

-- ── 네이버 캡처 묶음 1회 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_scans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  category_path    text,
  sort_label       text,
  parse_status     text NOT NULL DEFAULT 'pending'
                     CHECK (parse_status IN ('pending','parsing','parsed','failed')),
  parse_attempts   int NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  parse_started_at timestamptz,
  parse_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_scans_user
  ON sourcing_scans (user_id, created_at DESC);

-- ── 판독된 네이버 상품 1개 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id           uuid NOT NULL REFERENCES sourcing_scans(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  rank              int NOT NULL CHECK (rank > 0),
  title             text NOT NULL,
  seller            text NOT NULL,
  price             int NOT NULL CHECK (price > 0),
  list_price        int,
  discount_pct      int,
  review_count      int,
  rating            numeric(3,2),
  badges            text[] NOT NULL DEFAULT '{}',
  dedup_key         text NOT NULL,
  number_check      text,
  starred           boolean NOT NULL DEFAULT false,
  excluded_override boolean,
  memo              text,
  size              text NOT NULL DEFAULT 'small' CHECK (size IN ('xsmall','small','medium')),
  price_override    int CHECK (price_override > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_listings_dedup
  ON sourcing_listings (scan_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_sourcing_listings_starred
  ON sourcing_listings (user_id, starred) WHERE starred;

-- ── 1688 업체 1곳 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_offers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       uuid NOT NULL REFERENCES sourcing_listings(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  url              text,
  title_cn         text,
  tiers            jsonb,
  options          jsonb,
  sold_count       int,
  sale_unit        text,
  tier_check       text,
  match_verdict    text CHECK (match_verdict IN ('same','diff','different')),
  match_reason     text,
  cny_override     numeric(10,2) CHECK (cny_override > 0),
  adopted          boolean NOT NULL DEFAULT false,
  parse_status     text NOT NULL DEFAULT 'pending'
                     CHECK (parse_status IN ('pending','parsing','parsed','failed')),
  parse_attempts   int NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  parse_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_offers_listing ON sourcing_offers (listing_id);
-- 후보당 채택은 하나
CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_offers_adopted
  ON sourcing_offers (listing_id) WHERE adopted;
