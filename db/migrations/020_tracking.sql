-- 020_tracking.sql — P-15: shipment tracking events per order.
-- Run in Supabase SQL Editor AFTER 019, in order. Additive only.
-- Customer-visible milestone timeline (packed → shipped → hub → out for
-- delivery → delivered, plus honest delayed/failed events).

CREATE TABLE IF NOT EXISTS shipment_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN
               ('packed','shipped','hub_arrival','out_for_delivery',
                'delivered','delayed','failed')),
  label_en   text,
  label_ne   text,
  location   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_events_order ON shipment_events(order_id);
