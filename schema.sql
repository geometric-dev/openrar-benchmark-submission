-- OpenRAR RARMark v2.0 Cloud Benchmark Schema
-- Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    system TEXT NOT NULL,
    version TEXT NOT NULL,
    cpu_brand TEXT NOT NULL,
    arch TEXT NOT NULL,
    logical_cores INTEGER NOT NULL,
    simd_features TEXT NOT NULL, -- JSON array of strings e.g. ["AVX2", "BMI2"]
    threads INTEGER NOT NULL,
    dict_size_bytes INTEGER NOT NULL,
    method INTEGER NOT NULL,
    mem_bw_gbps REAL,
    st_compress_kbps REAL NOT NULL,
    mt_compress_kbps REAL NOT NULL,
    mt_decompress_kbps REAL NOT NULL,
    speedup_ratio REAL NOT NULL,
    rarmark_score INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1,
    ip_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved', -- 'approved', 'flagged', 'rejected'
    sync_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'synced'
    synced_at DATETIME,
    user_agent TEXT,
    slug TEXT NOT NULL
);

-- Performance & Query Indexes
CREATE INDEX IF NOT EXISTS idx_submissions_rank ON submissions (status, rarmark_score DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_arch ON submissions (arch, rarmark_score DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_sync ON submissions (status, sync_status);
CREATE INDEX IF NOT EXISTS idx_submissions_dedup ON submissions (ip_hash, cpu_brand, threads);

-- IP Rate Limiting Table (10-minute sliding window)
CREATE TABLE IF NOT EXISTS rate_limits (
    ip_hash TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL -- Unix timestamp in seconds
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

