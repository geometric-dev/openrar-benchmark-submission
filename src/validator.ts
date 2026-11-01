import { OpenRarBenchmarkPayload, ValidationResult } from './types';

export function sanitizeString(val: unknown, maxLen = 64, fallback = 'unknown'): string {
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[<>'"`;\\]/g, '').trim();
  return cleaned.slice(0, maxLen) || fallback;
}

export function generateSlug(payload: OpenRarBenchmarkPayload, uniqueId: string): string {
  const cpuPart = payload.cpu.brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const threads = payload.config.threads || payload.cpu.logical_cores || 1;
  const shortId = uniqueId.replace(/-/g, '').slice(0, 6);
  return `${cpuPart}-${threads}t-${shortId}`;
}

export function validateBenchmarkPayload(payload: any): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Invalid JSON payload: expected an object'] };
  }

  // 1. Benchmark signature
  if (payload.benchmark !== 'openrar_rarmark_v2') {
    errors.push("Invalid benchmark signature: expected 'openrar_rarmark_v2'");
  }

  // 2. CPU information
  const cpu = payload.cpu;
  if (!cpu || typeof cpu !== 'object') {
    errors.push('Missing or invalid "cpu" object');
  } else {
    if (!cpu.brand || typeof cpu.brand !== 'string' || cpu.brand.trim().length === 0) {
      errors.push('Missing cpu.brand');
    }
    if (!cpu.arch || typeof cpu.arch !== 'string') {
      errors.push('Missing cpu.arch');
    }
    const cores = Number(cpu.logical_cores);
    if (!Number.isInteger(cores) || cores < 1 || cores > 512) {
      errors.push('cpu.logical_cores must be an integer between 1 and 512');
    }
  }

  // 3. Config
  const config = payload.config;
  if (!config || typeof config !== 'object') {
    errors.push('Missing or invalid "config" object');
  } else {
    const threads = Number(config.threads);
    if (!Number.isInteger(threads) || threads < 1 || threads > 512) {
      errors.push('config.threads must be an integer between 1 and 512');
    }
  }

  // 4. Results & Decompression verification
  const results = payload.results;
  if (!results || typeof results !== 'object') {
    errors.push('Missing or invalid "results" object');
  } else {
    if (results.decompression_verified !== true) {
      errors.push('Integrity failure: decompression_verified must be true (CRC32 mismatch)');
    }

    const stComp = Number(results.st_compress_kbps);
    const mtComp = Number(results.mt_compress_kbps);
    const mtDecomp = Number(results.mt_decompress_kbps);
    const score = Number(results.rarmark_score);
    const speedup = Number(results.speedup_ratio);

    if (isNaN(stComp) || stComp <= 0 || stComp > 50_000_000) {
      errors.push('results.st_compress_kbps is out of plausible bounds (0..50,000,000 KB/s)');
    }
    if (isNaN(mtComp) || mtComp <= 0 || mtComp > 500_000_000) {
      errors.push('results.mt_compress_kbps is out of plausible bounds (0..500,000,000 KB/s)');
    }
    if (isNaN(mtDecomp) || mtDecomp <= 0 || mtDecomp > 5_000_000_000) {
      errors.push('results.mt_decompress_kbps is out of plausible bounds (0..5,000,000,000 KB/s)');
    }

    // Mathematical verification of RARMark score formula:
    // score = round((0.6 * mt_compress_kbps + 0.4 * mt_decompress_kbps) / 10.0)
    if (!isNaN(mtComp) && !isNaN(mtDecomp) && !isNaN(score)) {
      const expectedScore = Math.round((0.6 * mtComp + 0.4 * mtDecomp) / 10.0);
      const diff = Math.abs(score - expectedScore);
      const tolerance = Math.max(3, expectedScore * 0.005); // 0.5% tolerance or 3 points
      if (diff > tolerance) {
        errors.push(
          `RARMark score mathematical mismatch: reported ${score}, expected ~${expectedScore}`
        );
      }
    }

    // Plausibility check on speedup ratio vs core count
    if (cpu && cpu.logical_cores && !isNaN(speedup) && !isNaN(stComp) && !isNaN(mtComp)) {
      const cores = Number(cpu.logical_cores);
      const maxPlausibleSpeedup = cores * 1.5; // Allow reasonable hyperthreading / turbo boost headroom
      if (speedup > maxPlausibleSpeedup) {
        errors.push(
          `Speedup ratio ${speedup.toFixed(2)}x exceeds maximum plausible scaling for ${cores} logical cores`
        );
      }

      // Check ratio matches mt_compress / st_compress
      const calcSpeedup = mtComp / stComp;
      if (Math.abs(speedup - calcSpeedup) > 0.15 && Math.abs(speedup - calcSpeedup) / calcSpeedup > 0.08) {
        errors.push(
          `Reported speedup ratio (${speedup}) diverges from mt_compress / st_compress (${calcSpeedup.toFixed(2)})`
        );
      }
    }

    // Memory bandwidth check if present
    if (results.memory_bandwidth_gbps !== undefined && results.memory_bandwidth_gbps !== null) {
      const memBw = Number(results.memory_bandwidth_gbps);
      if (isNaN(memBw) || memBw < 0.1 || memBw > 3000.0) {
        errors.push('results.memory_bandwidth_gbps is out of plausible range (0.1..3000 GB/s)');
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

