CREATE TABLE m_live.m02_clob_price (
    asset_id TEXT PRIMARY KEY REFERENCES m_live.m01_gamma_outcome (asset_id),
    best_bid NUMERIC CHECK (best_bid > 0 AND best_bid < 1),
    best_ask NUMERIC CHECK (best_ask > 0 AND best_ask < 1),
    midpoint NUMERIC CHECK (midpoint >= 0 AND midpoint <= 1),
    last_trade_price NUMERIC CHECK (last_trade_price >= 0 AND last_trade_price <= 1),
    last_trade_side TEXT CHECK (last_trade_side IN ('BUY', 'SELL')),
    quote_observed_at TIMESTAMPTZ,
    mid_observed_at TIMESTAMPTZ,
    last_observed_at TIMESTAMPTZ
);
