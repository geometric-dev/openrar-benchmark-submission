import { LeaderboardEntry, OpenRarBenchmarkPayload, SubmissionRecord } from './types';
import { generateSlug, sanitizeString } from './validator';

export async function hashIp(ip: string): Promise<string> {
  const enc = new TextEncoder();
  // Salt with fixed project string to prevent rainbow table attacks
  const data = enc.encode(`openrar-salt:${ip}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkRateLimit(
  db: D1Database,
  ipHash: string,
  limit = 5,
  windowSeconds = 600
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;

  try {
    const existing = await db
      .prepare('SELECT count, window_start FROM rate_limits WHERE ip_hash = ?')
      .bind(ipHash)
      .first<{ count: number; window_start: number }>();

    if (!existing || existing.window_start < cutoff) {
      await db
        .prepare('INSERT OR REPLACE INTO rate_limits (ip_hash, count, window_start) VALUES (?, 1, ?)')
        .bind(ipHash, now)
        .run();
      return { allowed: true, remaining: limit - 1 };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    await db
      .prepare('UPDATE rate_limits SET count = count + 1 WHERE ip_hash = ?')
      .bind(ipHash)
      .run();

    return { allowed: true, remaining: limit - (existing.count + 1) };
  } catch (err) {
    console.error('Rate limit error, failing open for resilience:', err);
    return { allowed: true, remaining: limit };
  }
}

export async function insertOrUpdateSubmission(
  db: D1Database,
  payload: OpenRarBenchmarkPayload,
  meta: {
    ipHash: string;
    userAgent: string;
    status?: 'approved' | 'flagged' | 'rejected';
  }
): Promise<{ id: string; rank: number; isUpdate: boolean; slug: string }> {
  const id = crypto.randomUUID();
  const slug = generateSlug(payload, id);
  const system = sanitizeString(payload.system, 80, 'Custom Rig');
  const version = sanitizeString(payload.version, 16, '2.0.1');
  const cpuBrand = sanitizeString(payload.cpu.brand, 80, 'Unknown CPU');
  const arch = sanitizeString(payload.cpu.arch, 24, 'unknown');
  const simdStr = JSON.stringify(payload.cpu.simd_features || []);
  const status = meta.status || 'approved';

  // Check for deduplication: same IP + same CPU + same threads count
  const existing = await db
    .prepare(
      'SELECT id, rarmark_score, slug FROM submissions WHERE ip_hash = ? AND cpu_brand = ? AND threads = ? LIMIT 1'
    )
    .bind(meta.ipHash, cpuBrand, payload.config.threads)
    .first<{ id: string; rarmark_score: number; slug: string }>();

  let targetId = id;
  let targetSlug = slug;
  let isUpdate = false;

  if (existing) {
    targetId = existing.id;
    targetSlug = existing.slug;
    isUpdate = true;

    await db
      .prepare(
        `UPDATE submissions SET
          updated_at = CURRENT_TIMESTAMP,
          system = ?,
          version = ?,
          dict_size_bytes = ?,
          method = ?,
          mem_bw_gbps = ?,
          st_compress_kbps = ?,
          mt_compress_kbps = ?,
          mt_decompress_kbps = ?,
          speedup_ratio = ?,
          rarmark_score = ?,
          verified = 1,
          status = ?,
          sync_status = 'pending',
          user_agent = ?
        WHERE id = ?`
      )
      .bind(
        system,
        version,
        payload.config.dict_size_bytes || 4194304,
        payload.config.method || 3,
        payload.results.memory_bandwidth_gbps ?? null,
        payload.results.st_compress_kbps,
        payload.results.mt_compress_kbps,
        payload.results.mt_decompress_kbps,
        payload.results.speedup_ratio,
        payload.results.rarmark_score,
        status,
        meta.userAgent,
        targetId
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO submissions (
          id, system, version, cpu_brand, arch, logical_cores,
          simd_features, threads, dict_size_bytes, method, mem_bw_gbps,
          st_compress_kbps, mt_compress_kbps, mt_decompress_kbps,
          speedup_ratio, rarmark_score, verified, ip_hash, status,
          sync_status, user_agent, slug
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, 1, ?, ?,
          'pending', ?, ?
        )`
      )
      .bind(
        targetId,
        system,
        version,
        cpuBrand,
        arch,
        payload.cpu.logical_cores,
        simdStr,
        payload.config.threads,
        payload.config.dict_size_bytes || 4194304,
        payload.config.method || 3,
        payload.results.memory_bandwidth_gbps ?? null,
        payload.results.st_compress_kbps,
        payload.results.mt_compress_kbps,
        payload.results.mt_decompress_kbps,
        payload.results.speedup_ratio,
        payload.results.rarmark_score,
        meta.ipHash,
        status,
        meta.userAgent,
        targetSlug
      )
      .run();
  }

  // Calculate current rank
  const rankRow = await db
    .prepare(
      `SELECT COUNT(*) + 1 as rank FROM submissions
       WHERE status = 'approved' AND rarmark_score > ?`
    )
    .bind(payload.results.rarmark_score)
    .first<{ rank: number }>();

  return {
    id: targetId,
    rank: rankRow ? rankRow.rank : 1,
    isUpdate,
    slug: targetSlug,
  };
}

export async function getLeaderboard(
  db: D1Database,
  options: { limit?: number; offset?: number; arch?: string } = {}
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const offset = Math.max(options.offset || 0, 0);

  let countQuery = "SELECT COUNT(*) as count FROM submissions WHERE status = 'approved'";
  let selectQuery = "SELECT * FROM submissions WHERE status = 'approved'";
  const params: any[] = [];

  if (options.arch) {
    countQuery += ' AND arch = ?';
    selectQuery += ' AND arch = ?';
    params.push(options.arch);
  }

  selectQuery += ' ORDER BY rarmark_score DESC LIMIT ? OFFSET ?';

  const totalRow = await db.prepare(countQuery).bind(...params).first<{ count: number }>();
  const total = totalRow ? totalRow.count : 0;

  const rows = await db
    .prepare(selectQuery)
    .bind(...params, limit, offset)
    .all<SubmissionRecord>();

  const entries: LeaderboardEntry[] = (rows.results || []).map((row, idx) => {
    let simd: string[] = [];
    try {
      simd = JSON.parse(row.simd_features);
    } catch {
      simd = [];
    }

    return {
      rank: offset + idx + 1,
      id: row.id,
      system: row.system,
      cpu_brand: row.cpu_brand,
      arch: row.arch,
      logical_cores: row.logical_cores,
      threads: row.threads,
      simd_features: simd,
      mem_bw_gbps: row.mem_bw_gbps,
      st_compress_kbps: row.st_compress_kbps,
      mt_compress_kbps: row.mt_compress_kbps,
      mt_decompress_kbps: row.mt_decompress_kbps,
      speedup_ratio: row.speedup_ratio,
      rarmark_score: row.rarmark_score,
      created_at: row.created_at,
    };
  });

  return { entries, total };
}

export async function getExportData(
  db: D1Database,
  options: { limit?: number; syncOnlyPending?: boolean } = {}
): Promise<any[]> {
  const limit = Math.min(options.limit || 500, 1000);
  let query = "SELECT * FROM submissions WHERE status = 'approved'";

  if (options.syncOnlyPending) {
    query += " AND sync_status = 'pending'";
  }

  query += ' ORDER BY rarmark_score DESC LIMIT ?';

  const rows = await db.prepare(query).bind(limit).all<SubmissionRecord>();

  return (rows.results || []).map(row => {
    let simd: string[] = [];
    try {
      simd = JSON.parse(row.simd_features);
    } catch {
      simd = [];
    }

    return {
      id: row.id,
      slug: row.slug,
      benchmark: 'openrar_rarmark_v2',
      version: row.version,
      system: row.system,
      created_at: row.created_at,
      cpu: {
        brand: row.cpu_brand,
        arch: row.arch,
        logical_cores: row.logical_cores,
        simd_features: simd,
      },
      config: {
        threads: row.threads,
        dict_size_bytes: row.dict_size_bytes,
        method: row.method,
      },
      results: {
        memory_bandwidth_gbps: row.mem_bw_gbps,
        st_compress_kbps: row.st_compress_kbps,
        mt_compress_kbps: row.mt_compress_kbps,
        mt_decompress_kbps: row.mt_decompress_kbps,
        speedup_ratio: row.speedup_ratio,
        rarmark_score: row.rarmark_score,
        decompression_verified: true,
      },
    };
  });
}

export async function markSynced(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db
    .prepare(
      `UPDATE submissions SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .run();
}

export async function getStats(db: D1Database): Promise<{
  totalSubmissions: number;
  avgScore: number;
  topScore: number;
  topCpu: string;
  architectures: Record<string, number>;
}> {
  const summary = await db
    .prepare(
      `SELECT
        COUNT(*) as total,
        AVG(rarmark_score) as avg_score,
        MAX(rarmark_score) as max_score
       FROM submissions WHERE status = 'approved'`
    )
    .first<{ total: number; avg_score: number; max_score: number }>();

  const topRow = await db
    .prepare(
      `SELECT cpu_brand, threads FROM submissions
       WHERE status = 'approved' ORDER BY rarmark_score DESC LIMIT 1`
    )
    .first<{ cpu_brand: string; threads: number }>();

  const archRows = await db
    .prepare(
      `SELECT arch, COUNT(*) as count FROM submissions
       WHERE status = 'approved' GROUP BY arch`
    )
    .all<{ arch: string; count: number }>();

  const architectures: Record<string, number> = {};
  for (const r of archRows.results || []) {
    architectures[r.arch] = r.count;
  }

  return {
    totalSubmissions: summary ? summary.total : 0,
    avgScore: summary && summary.avg_score ? Math.round(summary.avg_score) : 0,
    topScore: summary && summary.max_score ? summary.max_score : 0,
    topCpu: topRow ? `${topRow.cpu_brand} (${topRow.threads}T)` : 'N/A',
    architectures,
  };
}

