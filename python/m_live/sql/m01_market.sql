CREATE TABLE m_live.m01_event (
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
    m_live_updated_at TIMESTAMPTZ NOT NULL,
    game_id TEXT,
    game_start_at TIMESTAMPTZ,
    game_date DATE,
    score TEXT,
    period TEXT,
    elapsed TEXT,
    live BOOLEAN,
    ended BOOLEAN,
    game_finished_at TIMESTAMPTZ,
    teams JSONB,
    sport JSONB
);
CREATE INDEX market_event_ranking ON m_live.m01_event (volume_24h DESC NULLS LAST, event_id)
WHERE in_current_scan AND active AND NOT closed AND NOT archived;
CREATE TABLE m_live.m01_market (
    market_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES m_live.m01_event (event_id),
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
    m_live_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ,
    closed_time TIMESTAMPTZ,
    resolution_status TEXT,
    resolved_seen_at TIMESTAMPTZ,
    sports_market_type TEXT,
    -- Approved public column name.
    line NUMERIC, -- noqa: RF04
    uma_resolution_statuses JSONB
);
CREATE INDEX market_market_event ON m_live.m01_market (event_id, sort_order, market_id);
CREATE TABLE m_live.m01_outcome (
    market_id TEXT NOT NULL REFERENCES m_live.m01_market (market_id),
    outcome_index INTEGER NOT NULL CHECK (outcome_index >= 0),
    -- This approved public column name is retained.
    label TEXT NOT NULL, -- noqa: RF04
    token_id TEXT,
    position_id TEXT,
    asset_id TEXT UNIQUE,
    resolved_price NUMERIC CHECK (resolved_price >= 0 AND resolved_price <= 1),
    PRIMARY KEY (market_id, outcome_index)
);
CREATE INDEX market_created ON m_live.m01_market (created_at DESC NULLS LAST);
CREATE INDEX market_closed ON m_live.m01_market (closed_time DESC NULLS LAST);
CREATE INDEX market_follow ON m_live.m01_market (market_id)
WHERE (closed AND resolution_status IS DISTINCT FROM 'resolved') OR (NOT closed AND NOT in_current_scan);
CREATE TABLE m_live.m01_demand_market (
    market_id TEXT PRIMARY KEY REFERENCES m_live.m01_market (market_id),
    refresh_seconds INTEGER NOT NULL CHECK (refresh_seconds > 0),
    book_levels INTEGER CHECK (book_levels >= 0)
);
