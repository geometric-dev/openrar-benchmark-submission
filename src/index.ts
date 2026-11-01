import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, OpenRarBenchmarkPayload } from './types';
import { validateBenchmarkPayload } from './validator';
import {
  checkRateLimit,
  getExportData,
  getLeaderboard,
  getStats,
  hashIp,
  insertOrUpdateSubmission,
} from './db';
import { renderDashboardHtml } from './html';
import { syncSubmissionsDirectlyToGitHub, triggerGitHubDispatch } from './github';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for API consumers
app.use('/api/*', cors());

// Health check
app.get('/api/health', c => {
  return c.json({
    status: 'ok',
    version: '2.0.1',
    service: 'openrar-benchmark-submission',
    timestamp: new Date().toISOString(),
  });
});

// HTML Landing Page & Leaderboard
app.get('/', async c => {
  try {
    const { entries } = await getLeaderboard(c.env.DB, { limit: 50 });
    const stats = await getStats(c.env.DB);
    const html = renderDashboardHtml(entries, stats);
    return c.html(html);
  } catch (err: any) {
    console.error('Error rendering dashboard:', err);
    return c.html(`<h1>OpenRAR Benchmark Submission Service</h1><p>Running. (Database initializing...)</p>`);
  }
});

// In-memory isolate-level burst rate limiter (sub-millisecond, absorbs spam without hitting D1)
const ipBurstMap = new Map<string, number>();
function checkBurst(ipHash: string, minIntervalMs = 1500): boolean {
  const now = Date.now();
  const last = ipBurstMap.get(ipHash) || 0;
  if (now - last < minIntervalMs) {
    return false;
  }
  ipBurstMap.set(ipHash, now);
  if (ipBurstMap.size > 10000) {
    ipBurstMap.clear();
  }
  return true;
}

// Ingestion API: OpenRAR client submissions
app.post('/api/submit', async c => {
  try {
    // 1. Content-Length guard: reject oversized payloads (> 16 KiB) immediately (0 D1 operations)
    const contentLength = Number(c.req.header('content-length') || '0');
    if (contentLength > 16384) {
      return c.json({ success: false, error: 'Payload too large (maximum 16 KiB)' }, 413);
    }

    const rawIp =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      '127.0.0.1';
    const userAgent = c.req.header('user-agent') || 'openrar-client';

    const ipHash = await hashIp(rawIp);

    // 2. Isolate-level fast burst guard: reject requests faster than 1 per 1.5s per IP (0 D1 operations)
    if (c.env.ENVIRONMENT !== 'test' && !checkBurst(ipHash, 1500)) {
      return c.json(
        { success: false, error: 'Burst rate limit: please wait a moment between submissions.' },
        429
      );
    }

    // 3. Parse JSON body
    let payload: OpenRarBenchmarkPayload;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    // 4. Validate schema, mathematical formula, decompression integrity, and scaling bounds
    // Done in pure CPU memory BEFORE checking D1 to prevent D1 quota exhaustion from invalid spam
    const validation = validateBenchmarkPayload(payload);
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: 'Benchmark validation failed',
          details: validation.errors,
        },
        422
      );
    }

    // 5. Persistent D1 Rate limit: 5 approved submissions per 10 minutes per IP
    const rateCheck = await checkRateLimit(c.env.DB, ipHash, 5, 600);
    if (!rateCheck.allowed) {
      return c.json(
        {
          success: false,
          error: 'Rate limit exceeded: maximum 5 benchmark submissions per 10 minutes.',
        },
        429
      );
    }

    // Insert or update in Cloudflare D1
    const result = await insertOrUpdateSubmission(c.env.DB, payload, {
      ipHash,
      userAgent,
      status: 'approved',
    });

    return c.json({
      success: true,
      message: result.isUpdate
        ? 'Benchmark successfully updated in leaderboard!'
        : 'Benchmark successfully accepted and ranked!',
      id: result.id,
      slug: result.slug,
      rank: result.rank,
      rarmark_score: payload.results.rarmark_score,
      is_update: result.isUpdate,
    });
  } catch (err: any) {
    console.error('Submission processing error:', err);
    return c.json(
      {
        success: false,
        error: 'Internal server error while processing submission',
        message: err.message,
      },
      500
    );
  }
});

// Leaderboard API
app.get('/api/leaderboard', async c => {
  try {
    const limit = Number(c.req.query('limit') || '50');
    const offset = Number(c.req.query('offset') || '0');
    const arch = c.req.query('arch');

    const data = await getLeaderboard(c.env.DB, { limit, offset, arch });
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: 'Failed to query leaderboard', message: err.message }, 500);
  }
});

// Export API for tools/aggregate_benchmarks.py
app.get('/api/export', async c => {
  try {
    const limit = Number(c.req.query('limit') || '500');
    const syncOnlyPending = c.req.query('pending') === 'true';

    const data = await getExportData(c.env.DB, { limit, syncOnlyPending });
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: 'Failed to export benchmark records', message: err.message }, 500);
  }
});

// Stats API
app.get('/api/stats', async c => {
  try {
    const stats = await getStats(c.env.DB);
    return c.json(stats);
  } catch (err: any) {
    return c.json({ error: 'Failed to compute stats', message: err.message }, 500);
  }
});

// Sync API (Manual or Webhook triggered)
app.post('/api/sync/github', async c => {
  const authHeader = c.req.header('authorization');
  const adminKey = c.env.ADMIN_KEY;

  if (adminKey && authHeader !== `Bearer ${adminKey}`) {
    return c.json({ error: 'Unauthorized: invalid ADMIN_KEY' }, 401);
  }

  const result = await syncSubmissionsDirectlyToGitHub(c.env);
  return c.json(result);
});

export { app };

// Cloudflare Scheduled Worker (Cron trigger)
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron trigger fired at ${new Date(event.scheduledTime).toISOString()}`);
    ctx.waitUntil(
      (async () => {
        try {
          const syncRes = await syncSubmissionsDirectlyToGitHub(env);
          console.log(`Automated sync result: ${JSON.stringify(syncRes)}`);
        } catch (err) {
          console.error('Scheduled sync failed:', err);
        }
      })()
    );
  },
};

