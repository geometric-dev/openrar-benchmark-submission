# OpenRAR Benchmark Submission & Cloud Leaderboard Service

[![CI](https://github.com/geometric-dev/openrar-benchmark-submission/actions/workflows/ci.yml/badge.svg)](https://github.com/geometric-dev/openrar-benchmark-submission/actions/workflows/ci.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Compute-Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Storage-Cloudflare%20D1%20SQLite-blue)](https://developers.cloudflare.com/d1/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Edge ingestion service, automated verification pipeline, and live hardware leaderboard for **[OpenRAR RARMark v2.0](https://github.com/geometric-dev/openrar)** benchmarks.

---

## 🏗️ System Architecture

```
                  ┌────────────────────────────────────────┐
                  │           OpenRAR Client Engine        │
                  │   openrar b --json (in-memory test)    │
                  └───────────────────┬────────────────────┘
                                      │  HTTP POST /api/submit
                                      ▼
                  ┌────────────────────────────────────────┐
                  │      Cloudflare Edge Worker (Hono)     │
                  │  • IP Hash Rate Limiting (5/10 min)    │
                  │  • Decompression CRC32 Verification    │
                  │  • RARMark Formula Math Integrity      │
                  │  • Physical Core Scaling Bounds        │
                  └───────────────────┬────────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│   Cloudflare D1 (SQLite)     │              │      Periodic GitHub Sync    │
│  • submissions table         │              │  • Cloudflare Cron (0 0 * *) │
│  • indexed by RARMark score  │◄─────────────┤  • or openrar GH Action Cron │
│  • deduplication & status    │  /api/export │  • updates BENCHMARKS.md     │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               ▼                                             ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│   Live Web Dashboard (HTML)  │              │   geometric-dev/openrar      │
│   https://benchmarks.        │              │   benchmarks/submissions/    │
│   openrar.dev/               │              │   BENCHMARKS.md (Ranked Table│
└──────────────────────────────┘              └──────────────────────────────┘
```

---

## 💾 Storage Architecture Rationale: Cloudflare D1

When designing the storage layer for hardware benchmark ingestion at the edge, three Cloudflare primitives were evaluated:

| Feature / Criteria | Cloudflare KV | Cloudflare R2 | **Cloudflare D1 (Chosen)** |
| :--- | :--- | :--- | :--- |
| **Data Model** | Key-Value string/JSON | Object Blob Store | **Relational SQLite Tables** |
| **Ordering & Ranking** | Lacks native sorting; requires in-memory aggregation of all keys | Requires prefix listing & reading separate files | **Native SQL `ORDER BY rarmark_score DESC LIMIT ?`** |
| **Deduplication** | Manual key mapping prone to race conditions | File overwrite only | **Composite indexes (`ip_hash, cpu_brand, threads`)** |
| **Filtering (Arch/Cores)** | Requires full scans | Requires complex metadata index | **Instant indexed `WHERE arch = ?`** |
| **Read Consistency** | Eventually consistent (up to 60s global delay) | Read-after-write consistent | **Strong consistency per primary replica** |
| **Cost & Footprint** | Billed per million reads | Billed per Class A/B ops | **Free tier: 5M reads/day, 100k writes/day** |

**Conclusion:** **Cloudflare D1** is the optimal storage engine. It provides relational SQLite tables with composite indexes on `rarmark_score`, `arch`, and deduplication keys, ensuring sub-5ms leaderboard queries without server cold starts or external database latency.

---

## 🛡️ Anti-Abuse & Data Integrity Pipeline

To prevent fabricated scores and spam from polluting the hardware rankings, incoming payloads pass through multi-layer verification:

1. **Cryptographic Decompression Verification**:
   The engine executes an in-memory compression followed by decompression and validates CRC32 against the original corpus. Submissions with `decompression_verified !== true` are immediately rejected.
2. **Mathematical Score Verification**:
   The payload must satisfy OpenRAR's RARMark v2.0 formula:
   $$\text{RARMark} = \frac{0.6 \times \text{MT Compression (KB/s)} + 0.4 \times \text{MT Decompression (KB/s)}}{10}$$
   Submitted scores diverging beyond rounding tolerance (0.5% or 3 points) are rejected.
3. **Plausibility & Hardware Scaling Bounds**:
   - `speedup_ratio` is verified against $\text{MT Compression} / \text{ST Compression}$.
   - Multithread speedup cannot exceed $\text{logical cores} \times 1.5$ (preventing fake 100x speedups on dual-core machines).
   - Single-thread and multi-thread throughputs must fall within physically feasible silicon bounds.
4. **Privacy-Preserving IP Rate Limiting**:
   Client IP addresses are salted and hashed using SHA-256 (no raw IPs stored). A sliding 10-minute window limits submissions to 5 per IP.
5. **Intelligent Deduplication**:
   Subsequent submissions from the same user/machine update the existing record rather than fragmenting the leaderboard with identical runs.

---

## 🚀 Quick Start for OpenRAR Users

### Submitting via CLI (Piping JSON)

Run `openrar b --json` and pipe directly to the ingestion API:

```bash
# Windows (PowerShell)
openrar b --json | Invoke-RestMethod -Uri "https://benchmark.openrar.workers.dev/api/submit" -Method Post -ContentType "application/json"

# Linux / macOS (cURL)
openrar b --json | curl -s -X POST -H "Content-Type: application/json" -d @- https://benchmark.openrar.workers.dev/api/submit
```

### Submitting via Python Helper

```bash
python scripts/submit_benchmark.py --submitter "@your_handle" --system "Watercooled Ryzen 9"
```

---

## 📡 API Reference

### 1. Ingest Benchmark
- **Endpoint:** `POST /api/submit`
- **Headers:** `Content-Type: application/json`
- **Payload:** Output of `openrar b --json`
- **Response:**
  ```json
  {
    "success": true,
    "message": "Benchmark successfully accepted and ranked!",
    "id": "7f8b9c1d-...",
    "slug": "amd-epyc-7763-64t-a1b2c3",
    "rank": 4,
    "rarmark_score": 142850,
    "is_update": false
  }
  ```

### 2. Query Leaderboard
- **Endpoint:** `GET /api/leaderboard?limit=50&offset=0&arch=x86_64`
- **Response:**
  ```json
  {
    "total": 42,
    "entries": [
      {
        "rank": 1,
        "id": "...",
        "system": "MacBook Pro M3 Max",
        "submitter": "Linus",
        "cpu_brand": "Apple M3 Max",
        "arch": "ARM64",
        "logical_cores": 16,
        "threads": 16,
        "simd_features": ["NEON LZ", "NEON BLAKE2sp", "AES"],
        "mem_bw_gbps": 154.2,
        "st_compress_kbps": 28000.0,
        "mt_compress_kbps": 360000.0,
        "mt_decompress_kbps": 4500000.0,
        "speedup_ratio": 12.85,
        "rarmark_score": 201600,
        "created_at": "2026-11-01T09:00:00Z"
      }
    ]
  }
  ```

### 3. Export for OpenRAR Aggregator
- **Endpoint:** `GET /api/export`
- **Description:** Returns JSON array directly consumed by OpenRAR's `tools/aggregate_benchmarks.py`.

### 4. Health & Stats
- **Endpoint:** `GET /api/health`
- **Endpoint:** `GET /api/stats`

---

## 🔄 GitHub Synchronization Mechanism

Results from Cloudflare D1 are periodically synchronized into [`BENCHMARKS.md`](https://github.com/geometric-dev/openrar/blob/v2/BENCHMARKS.md) in the primary `geometric-dev/openrar` repository through two automated paths:

### Method A: OpenRAR GitHub Actions Scheduled Pull
A scheduled GitHub Actions workflow in `geometric-dev/openrar` runs daily at 02:00 UTC:
1. Queries `GET https://benchmarks.openrar.dev/api/export`.
2. Writes verified benchmark entries to `benchmarks/submissions/{slug}.json`.
3. Runs `python tools/aggregate_benchmarks.py` to regenerate `BENCHMARKS.md`.
4. Commits and pushes the updated leaderboard table automatically.

### Method B: Cloudflare Worker Scheduled Cron Push
Cloudflare Workers feature native Cron Triggers (`crons = ["0 0 * * *"]`). When configured with `GITHUB_TOKEN`, the worker's `scheduled` handler:
1. Queries all newly approved submissions (`sync_status = 'pending'`).
2. Dispatches a `repository_dispatch` event or directly commits the JSON files to `geometric-dev/openrar`.
3. Marks the records as `synced` in D1.

---

## 🛠️ Local Development & Deployment

### 1. Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0

### 2. Setup & Testing
```bash
# Clone and install dependencies
git clone https://github.com/geometric-dev/openrar-benchmark-submission.git
cd openrar-benchmark-submission
npm install

# Run type check
npm run typecheck

# Run unit tests
npm test

# Initialize local SQLite D1 database
npm run d1:local

# Start local edge development server
npm run dev
```

### 3. Deploying to Cloudflare
```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Create the D1 Database
npx wrangler d1 create openrar-benchmarks

# 3. Copy the database_id from output and update wrangler.toml:
# database_id = "<your-d1-uuid>"

# 4. Apply schema migrations to remote D1
npm run d1:remote

# 5. Set secrets (optional, for GitHub sync)
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_KEY

# 6. Deploy Worker
npm run deploy
```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
