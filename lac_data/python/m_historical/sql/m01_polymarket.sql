CREATE TABLE m_historical.m01_polymarket_price (
    asset_id TEXT NOT NULL,
    minute_at TIMESTAMPTZ NOT NULL,
    source_at TIMESTAMPTZ NOT NULL,
    price NUMERIC NOT NULL CHECK (price >= 0 AND price <= 1),
    resolution_seconds INTEGER NOT NULL CHECK (resolution_seconds IN (0, 60)),
    PRIMARY KEY (asset_id, minute_at)
);
CREATE TABLE m_historical.m01_polymarket_coverage (
    asset_id TEXT PRIMARY KEY,
    requested_start TIMESTAMPTZ NOT NULL,
    requested_end TIMESTAMPTZ NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'error')),
    point_count INTEGER CHECK (point_count >= 0),
    error_reason TEXT,
    CHECK (requested_end > requested_start),
    CHECK (
        (status = 'success' AND point_count IS NOT NULL AND error_reason IS NULL)
        OR (status = 'error' AND point_count IS NULL AND error_reason IS NOT NULL)
    )
);
