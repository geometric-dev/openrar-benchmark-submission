export interface CpuInfo {
  brand: string;
  arch: string;
  logical_cores: number;
  simd_features: string[];
}

export interface BenchmarkConfig {
  threads: number;
  dict_size_bytes: number;
  method: number;
}

export interface BenchmarkResults {
  memory_bandwidth_gbps?: number | null;
  st_compress_kbps: number;
  mt_compress_kbps: number;
  mt_decompress_kbps: number;
  speedup_ratio: number;
  rarmark_score: number;
  decompression_verified: boolean;
}

export interface OpenRarBenchmarkPayload {
  benchmark: string;
  version: string;
  system?: string;
  submitter?: string;
  cpu: CpuInfo;
  config: BenchmarkConfig;
  results: BenchmarkResults;
}

export interface SubmissionRecord {
  id: string;
  created_at: string;
  updated_at: string;
  system: string;
  submitter: string;
  version: string;
  cpu_brand: string;
  arch: string;
  logical_cores: number;
  simd_features: string; // JSON string
  threads: number;
  dict_size_bytes: number;
  method: number;
  mem_bw_gbps: number | null;
  st_compress_kbps: number;
  mt_compress_kbps: number;
  mt_decompress_kbps: number;
  speedup_ratio: number;
  rarmark_score: number;
  verified: number;
  ip_hash: string;
  status: 'approved' | 'flagged' | 'rejected';
  sync_status: 'pending' | 'synced';
  synced_at: string | null;
  user_agent: string | null;
  slug: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  system: string;
  submitter: string;
  cpu_brand: string;
  arch: string;
  logical_cores: number;
  threads: number;
  simd_features: string[];
  mem_bw_gbps: number | null;
  st_compress_kbps: number;
  mt_compress_kbps: number;
  mt_decompress_kbps: number;
  speedup_ratio: number;
  rarmark_score: number;
  created_at: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  flagged?: boolean;
  flag_reason?: string;
}

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  GITHUB_REPO?: string;
  GITHUB_TARGET_BRANCH?: string;
  GITHUB_TOKEN?: string;
  ADMIN_KEY?: string;
}

