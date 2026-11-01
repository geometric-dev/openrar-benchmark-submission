import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

// Create a lightweight in-memory mock for D1 database for unit testing
function createMockD1(): any {
  const store: any[] = [];
  return {
    prepare(query: string) {
      return {
        bind(...params: any[]) {
          return {
            async first() {
              if (query.includes('COUNT(*) as total')) {
                return { total: store.length, avg_score: 50000, max_score: 100000 };
              }
              if (query.includes('COUNT(*) + 1 as rank')) {
                return { rank: 1 };
              }
              if (query.includes('SELECT count, window_start FROM rate_limits')) {
                return null;
              }
              return null;
            },
            async all() {
              if (query.includes('SELECT * FROM submissions')) {
                return { results: store };
              }
              if (query.includes('SELECT arch, COUNT(*)')) {
                return { results: [{ arch: 'ARM64', count: 1 }] };
              }
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

describe('API Endpoints', () => {
  const mockEnv = {
    DB: createMockD1(),
    ENVIRONMENT: 'test',
  };

  it('GET /api/health returns 200 and ok status', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('openrar-benchmark-submission');
  });

  it('POST /api/submit rejects malformed payload with 422', async () => {
    const res = await app.request(
      '/api/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmark: 'invalid' }),
      },
      mockEnv
    );
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Benchmark validation failed');
  });

  it('POST /api/submit accepts valid benchmark payload', async () => {
    const validPayload = {
      benchmark: 'openrar_rarmark_v2',
      version: '2.0.1',
      system: 'Test Rig',
      submitter: 'Tester',
      cpu: {
        brand: 'AMD Ryzen 9 7950X',
        arch: 'x86_64',
        logical_cores: 32,
        simd_features: ['AVX2', 'AVX-512', 'AES'],
      },
      config: {
        threads: 32,
        dict_size_bytes: 4194304,
        method: 3,
      },
      results: {
        memory_bandwidth_gbps: 64.2,
        st_compress_kbps: 30000.0,
        mt_compress_kbps: 600000.0,
        mt_decompress_kbps: 3000000.0,
        speedup_ratio: 20.0,
        // (0.6 * 600000 + 0.4 * 3000000) / 10 = (360000 + 1200000) / 10 = 156000
        rarmark_score: 156000,
        decompression_verified: true,
      },
    };

    const res = await app.request(
      '/api/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      },
      mockEnv
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.rarmark_score).toBe(156000);
  });
});
