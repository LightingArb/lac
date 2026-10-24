CREATE TABLE m_historical.m01_price_day (
    market_id TEXT NOT NULL REFERENCES m_live.m01_market (market_id),
    asset_id TEXT NOT NULL,
    day DATE NOT NULL, -- noqa: RF04
    prices NUMERIC [],
    status TEXT NOT NULL,
    error_reason TEXT,
    error_http_status INTEGER,
    error_count INTEGER NOT NULL DEFAULT 0,
    requested_at TIMESTAMPTZ NOT NULL,
    m_historical_updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (market_id, day),
    CONSTRAINT m01_price_day_status_check CHECK (
        (status = 'success' AND prices IS NOT NULL)
        OR (status IN ('no_data', 'error') AND prices IS NULL)
    ),
    CONSTRAINT m01_price_day_error_check CHECK (
        error_count >= 0
        AND (
            (
                status = 'error' AND error_count > 0
                AND error_reason IS NOT NULL AND error_reason <> ''
            )
            OR (status <> 'error' AND error_reason IS NULL AND error_http_status IS NULL)
        )
        AND (error_http_status IS NULL OR error_http_status BETWEEN 100 AND 599)
    ),
    CHECK (
        prices IS NULL OR (
            array_ndims(prices) = 1
            AND array_lower(prices, 1) = 1
            AND cardinality(prices) = 1440
        )
    )
);
