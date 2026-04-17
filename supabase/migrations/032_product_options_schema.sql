-- ═══════════════════════════════════════════════════════════════
-- 032_product_options_schema.sql
-- 도매꾹 옵션 데이터 저장 + 채널별 등록 이력
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. product_option_groups — 옵션 축 정의 (색상, 사이즈 등)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_option_groups (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_item_id uuid       NOT NULL REFERENCES public.sourcing_items(id) ON DELETE CASCADE,
  group_order     smallint    NOT NULL DEFAULT 0,
  group_name      text        NOT NULL,
  group_values    text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sourcing_item_id, group_order)
);

CREATE INDEX IF NOT EXISTS idx_option_groups_sourcing_item
  ON public.product_option_groups(sourcing_item_id);

-- ─────────────────────────────────────────────────────────────
-- 2. product_option_variants — 옵션 조합 (SKU 단위)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_option_variants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_item_id  uuid        NOT NULL REFERENCES public.sourcing_items(id) ON DELETE CASCADE,
  variant_key       text        NOT NULL,                -- "00", "00_01" (도매꾹 data 키)
  option_values     text[]      NOT NULL,                -- {"블랙","XL"}
  source_hash       text,                                -- 도매꾹 주문용 해시
  cost_price        integer     NOT NULL DEFAULT 0,      -- 도매가 + 추가금액 (원)
  sale_price_coupang integer,                            -- NULL이면 기본가 사용
  sale_price_naver   integer,                            -- NULL이면 기본가 사용
  stock             integer     NOT NULL DEFAULT 0,
  is_sold_out       boolean     NOT NULL DEFAULT false,
  is_hidden         boolean     NOT NULL DEFAULT false,
  is_enabled        boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sourcing_item_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_option_variants_sourcing_item
  ON public.product_option_variants(sourcing_item_id);

CREATE INDEX IF NOT EXISTS idx_option_variants_enabled
  ON public.product_option_variants(sourcing_item_id, is_enabled)
  WHERE is_enabled = true;

COMMIT;
