-- supabase/migrations/075_rg_shipment_events.sql
BEGIN;

CREATE TABLE IF NOT EXISTS rg_shipment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  shipped_at         date NOT NULL,
  total_shipping_fee integer NOT NULL CHECK (total_shipping_fee >= 0),
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_shipment_events_user
  ON rg_shipment_events (user_id, shipped_at DESC);

CREATE TABLE IF NOT EXISTS rg_shipment_event_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_event_id uuid NOT NULL REFERENCES rg_shipment_events(id) ON DELETE CASCADE,
  product_cost_id   uuid NOT NULL,
  product_name      text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_rg_fee       integer NOT NULL CHECK (unit_rg_fee >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rg_shipment_event_items_event
  ON rg_shipment_event_items (shipment_event_id);

COMMIT;
