CREATE TABLE m_live.m02_clob_price (
    market_id TEXT PRIMARY KEY REFERENCES m_live.m01_market (market_id),
    asset_id TEXT NOT NULL,
    best_bid NUMERIC CHECK (best_bid >= 0 AND best_bid <= 1),
    best_ask NUMERIC CHECK (best_ask >= 0 AND best_ask <= 1),
    requested_at TIMESTAMPTZ NOT NULL,
    m_live_updated_at TIMESTAMPTZ NOT NULL
);
