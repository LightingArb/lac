CREATE TABLE m_live.m01_gamma_event (
    event_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    resolution_source TEXT,
    image_url TEXT,
    icon_url TEXT,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL,
    closed BOOLEAN NOT NULL,
    archived BOOLEAN NOT NULL,
    volume_total NUMERIC CHECK (volume_total >= 0),
    volume_24h NUMERIC CHECK (volume_24h >= 0),
    liquidity NUMERIC CHECK (liquidity >= 0),
    tags JSONB NOT NULL,
    source_updated_at TIMESTAMPTZ,
    in_current_scan BOOLEAN NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX gamma_event_ranking ON m_live.m01_gamma_event (volume_24h DESC NULLS LAST, event_id)
WHERE in_current_scan AND active AND NOT closed AND NOT archived;
CREATE TABLE m_live.m01_gamma_market (
    market_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES m_live.m01_gamma_event (event_id),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    condition_id TEXT,
    protocol_version TEXT NOT NULL,
    slug TEXT NOT NULL,
    question TEXT NOT NULL,
    group_title TEXT,
    description TEXT,
    resolution_source TEXT,
    image_url TEXT,
    icon_url TEXT,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL,
    closed BOOLEAN NOT NULL,
    archived BOOLEAN NOT NULL,
    accepting_orders BOOLEAN,
    enable_order_book BOOLEAN,
    volume_total NUMERIC CHECK (volume_total >= 0),
    volume_24h NUMERIC CHECK (volume_24h >= 0),
    liquidity NUMERIC CHECK (liquidity >= 0),
    source_updated_at TIMESTAMPTZ,
    in_current_scan BOOLEAN NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX gamma_market_event ON m_live.m01_gamma_market (event_id, sort_order, market_id);
CREATE TABLE m_live.m01_gamma_outcome (
    market_id TEXT NOT NULL REFERENCES m_live.m01_gamma_market (market_id),
    outcome_index INTEGER NOT NULL CHECK (outcome_index >= 0),
    -- This approved public column name is retained.
    label TEXT NOT NULL, -- noqa: RF04
    token_id TEXT,
    position_id TEXT,
    asset_id TEXT UNIQUE,
    PRIMARY KEY (market_id, outcome_index)
);
