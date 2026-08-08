-- 코스트코 영수증 자동 입고
-- spec docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md §4
--
-- 적용: Supabase 대시보드 SQL Editor에서 직접 실행한다.

-- ── 영수증 1장 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipt_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  purchased_at     date,
  purchased_time   time,
  register_no      text,
  store_name       text,
  receipt_total    int,
  total_item_count int,
  tax_exempt_total int,
  taxable_total    int,
  vat              int,
  verify_status    text NOT NULL DEFAULT 'unreadable'
                     CHECK (verify_status IN ('matched','mismatch','unreadable')),
  verify_detail    jsonb,
  ocr_status       text NOT NULL DEFAULT 'pending'
                     CHECK (ocr_status IN ('pending','parsed','failed')),
  raw_ocr          jsonb,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','done','discarded')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_drafts_user
  ON receipt_drafts (user_id, created_at DESC);

-- 중복 의심 판정용. 날짜+금액만으로는 오탐이 난다 (spec §7)
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_dup
  ON receipt_drafts (user_id, purchased_at, purchased_time, register_no, receipt_total);

-- ── 품목 1줄 = 확정 단위 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipt_draft_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id           uuid NOT NULL REFERENCES receipt_drafts(id) ON DELETE CASCADE,
  line_no            int NOT NULL,
  item_code          text,
  item_label         text NOT NULL,
  quantity           numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit_price         int,
  amount             int NOT NULL,
  is_discount        boolean NOT NULL DEFAULT false,
  applies_to_line_id uuid REFERENCES receipt_draft_lines(id) ON DELETE SET NULL,
  tax_type           text NOT NULL DEFAULT 'unknown'
                       CHECK (tax_type IN ('taxable','exempt','unknown')),
  decision           text NOT NULL DEFAULT 'pending'
                       CHECK (decision IN ('pending','ingest','skip')),
  product_cost_id    uuid REFERENCES product_costs(id) ON DELETE SET NULL,
  entry_type         text CHECK (entry_type IN ('normal','subdivision')),
  items_per_box      int CHECK (items_per_box > 0),
  subdivision_unit   int CHECK (subdivision_unit > 0),
  cost_entry_id      uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- line_no는 확정 순서를 결정하므로 영수증 안에서 유일해야 한다
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_draft_lines_no
  ON receipt_draft_lines (draft_id, line_no);

-- ── 학습형 매핑 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costco_item_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  item_code          text NOT NULL,
  item_label         text,
  product_cost_id    uuid REFERENCES product_costs(id) ON DELETE SET NULL,
  default_decision   text NOT NULL DEFAULT 'ask'
                       CHECK (default_decision IN ('ingest','skip','ask')),
  default_entry_type text CHECK (default_entry_type IN ('normal','subdivision')),
  items_per_box      int CHECK (items_per_box > 0),
  subdivision_unit   int CHECK (subdivision_unit > 0),
  times_used         int NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_costco_item_map_code
  ON costco_item_map (user_id, item_code);

-- ── 역추적 ────────────────────────────────────────────────────
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS source_receipt_line_id uuid
    REFERENCES receipt_draft_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cost_entries_source_receipt
  ON cost_entries (source_receipt_line_id)
  WHERE source_receipt_line_id IS NOT NULL;

COMMENT ON TABLE receipt_drafts IS '코스트코 영수증 초안. spec 2026-08-08';
COMMENT ON TABLE receipt_draft_lines IS '영수증 품목 1줄. 확정 단위. spec 2026-08-08';
COMMENT ON TABLE costco_item_map IS '코스트코 품번 → 판매상품 학습형 매핑. spec 2026-08-08';

-- RLS: 활성화하되 정책 없음. 서버 API는 owner 연결로 우회하고
-- Supabase 클라이언트 직접 접근만 차단한다 (054 negotiation_logs 원칙, 089 daily_expenses 동일).
ALTER TABLE receipt_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_draft_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE costco_item_map ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_receipt_drafts_updated_at ON receipt_drafts;
CREATE TRIGGER trg_receipt_drafts_updated_at
  BEFORE UPDATE ON receipt_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_costco_item_map_updated_at ON costco_item_map;
CREATE TRIGGER trg_costco_item_map_updated_at
  BEFORE UPDATE ON costco_item_map
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
