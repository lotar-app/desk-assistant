CREATE INDEX IF NOT EXISTS idx_timeline_outbox_pending
  ON timeline_outbox(delivered_at, created_at, event_id);
