CREATE TABLE m_live.m03_clob_book (
    market_id TEXT PRIMARY KEY REFERENCES m_live.m01_market (market_id),
    asset_id TEXT NOT NULL,
    bids JSONB CHECK (jsonb_typeof(bids) = 'array'),
    asks JSONB CHECK (jsonb_typeof(asks) = 'array'),
    source_timestamp TIMESTAMPTZ,
    source_hash TEXT,
    tick_size NUMERIC CHECK (tick_size > 0 AND tick_size <= 1),
    min_order_size NUMERIC CHECK (min_order_size >= 0),
    requested_at TIMESTAMPTZ NOT NULL,
    m_live_updated_at TIMESTAMPTZ NOT NULL,
    CHECK ((bids IS NULL) = (asks IS NULL))
);
