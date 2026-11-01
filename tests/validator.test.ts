import { describe, it, expect } from 'vitest';
import { validateBenchmarkPayload, generateSlug, sanitizeString } from '../src/validator';
import { OpenRarBenchmarkPayload } from '../src/types';

describe('OpenRAR Benchmark Validator', () => {
  const validSample: OpenRarBenchmarkPayload = {
    benchmark: 'openrar_rarmark_v2',
    version: '2.0.1',
    system: 'Apple MacBook Pro M3 Max',
    submitter: 'Linus',
    cpu: {
      brand: 'Apple M3 Max',
      arch: 'ARM64',
      logical_cores: 16,
      simd_features: ['NEON LZ', 'NEON BLAKE2sp', 'AES', 'SHA'],
    },
    config: {
      threads: 16,
      dict_size_bytes: 4194304,
      method: 3,
    },
    results: {
      memory_bandwidth_gbps: 154.2,
      st_compress_kbps: 28000.0,
      mt_compress_kbps: 360000.0,
      mt_decompress_kbps: 4500000.0,
      speedup_ratio: 12.85,
      // (0.6 * 360000 + 0.4 * 4500000) / 10 = (216000 + 1800000) / 10 = 201600
      rarmark_score: 201600,
      decompression_verified: true,
    },
  };

  it('approves a valid benchmark payload', () => {
    const res = validateBenchmarkPayload(validSample);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects unverified decompression (CRC32 mismatch)', () => {
    const invalid = structuredClone(validSample);
    invalid.results.decompression_verified = false;
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('decompression_verified'))).toBe(true);
  });

  it('rejects incorrect benchmark signature', () => {
    const invalid = structuredClone(validSample);
    invalid.benchmark = 'openrar_rarmark_v1';
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('signature'))).toBe(true);
  });

  it('detects fabricated RARMark scores', () => {
    const invalid = structuredClone(validSample);
    // Real score should be 201600, submitter sends 999999
    invalid.results.rarmark_score = 999999;
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('mathematical mismatch'))).toBe(true);
  });

  it('rejects implausible multi-thread speedup ratio', () => {
    const invalid = structuredClone(validSample);
    // 16 cores, claiming 60x speedup
    invalid.results.speedup_ratio = 60.0;
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('Speedup ratio'))).toBe(true);
  });

  it('rejects negative or zero throughputs', () => {
    const invalid = structuredClone(validSample);
    invalid.results.mt_compress_kbps = 0;
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
  });

  it('rejects out of bounds memory bandwidth', () => {
    const invalid = structuredClone(validSample);
    invalid.results.memory_bandwidth_gbps = 50000.0;
    const res = validateBenchmarkPayload(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('memory_bandwidth_gbps'))).toBe(true);
  });
});

describe('Sanitization & Slug Generation', () => {
  it('sanitizes malicious characters', () => {
    const dirty = '<script>alert(1)</script>';
    expect(sanitizeString(dirty)).toBe('scriptalert(1)/script');
  });

  it('generates a clean slug', () => {
    const sample: OpenRarBenchmarkPayload = {
      benchmark: 'openrar_rarmark_v2',
      version: '2.0.1',
      cpu: {
        brand: 'AMD EPYC 7763 64-Core Processor',
        arch: 'x86_64',
        logical_cores: 64,
        simd_features: ['AVX2'],
      },
      config: { threads: 64, dict_size_bytes: 4194304, method: 3 },
      results: {
        st_compress_kbps: 10000,
        mt_compress_kbps: 500000,
        mt_decompress_kbps: 2000000,
        speedup_ratio: 50,
        rarmark_score: 110000,
        decompression_verified: true,
      },
    };

    const slug = generateSlug(sample, '12345678-abcd-ef01-2345-6789abcdef01');
    expect(slug).toBe('amd-epyc-7763-64-core-processor-64t-123456');
  });
});

