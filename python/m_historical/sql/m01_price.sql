CREATE TABLE m_historical.m01_price_day (
    market_id TEXT NOT NULL REFERENCES m_live.m01_market (market_id),
    asset_id TEXT NOT NULL,
    day DATE NOT NULL, -- noqa: RF04
    prices NUMERIC [],
    requested_at TIMESTAMPTZ NOT NULL,
    m_historical_updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (market_id, day),
    CHECK (
        prices IS NULL OR (
            array_ndims(prices) = 1
            AND array_lower(prices, 1) = 1
            AND cardinality(prices) = 1440
        )
    )
);
