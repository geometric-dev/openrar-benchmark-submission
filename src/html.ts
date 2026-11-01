import { LeaderboardEntry } from './types';

export function renderDashboardHtml(
  entries: LeaderboardEntry[],
  stats: {
    totalSubmissions: number;
    avgScore: number;
    topScore: number;
    topCpu: string;
    architectures: Record<string, number>;
  }
): string {
  const rowsHtml = entries
    .map(e => {
      const memBw = e.mem_bw_gbps ? `${e.mem_bw_gbps.toFixed(1)} GB/s` : '-';
      const stComp = (e.st_compress_kbps / 1024).toFixed(1) + ' MB/s';
      const mtComp = (e.mt_compress_kbps / 1024).toFixed(1) + ` MB/s (${e.speedup_ratio.toFixed(2)}x)`;
      const decomp =
        e.mt_decompress_kbps / 1024 >= 1024
          ? (e.mt_decompress_kbps / (1024 * 1024)).toFixed(2) + ' GB/s'
          : (e.mt_decompress_kbps / 1024).toFixed(1) + ' MB/s';

      const rankBadge =
        e.rank === 1
          ? '<span class="rank gold">🥇 1</span>'
          : e.rank === 2
          ? '<span class="rank silver">🥈 2</span>'
          : e.rank === 3
          ? '<span class="rank bronze">🥉 3</span>'
          : `<span class="rank default">#${e.rank}</span>`;

      const simdBadges = e.simd_features.slice(0, 3).map(s => `<span class="badge-simd">${s}</span>`).join(' ');

      return `<tr>
        <td class="col-rank">${rankBadge}</td>
        <td class="col-cpu">
          <div class="cpu-name">${escapeHtml(e.cpu_brand)}</div>
          <div class="system-sub">${escapeHtml(e.system)}</div>
        </td>
        <td><span class="badge-arch">${escapeHtml(e.arch)}</span></td>
        <td>${e.threads}T (${e.logical_cores}C)</td>
        <td>${simdBadges || '<span class="badge-simd">Scalar</span>'}</td>
        <td class="num">${memBw}</td>
        <td class="num">${stComp}</td>
        <td class="num">${mtComp}</td>
        <td class="num">${decomp}</td>
        <td class="num col-score"><strong>${e.rarmark_score.toLocaleString()}</strong></td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenRAR RARMark v2.0 Global Leaderboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --accent-green: #3fb950;
      --accent-gold: #d29922;
      --code-bg: #0b0f14;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.5;
      padding: 2rem 1.5rem;
    }
    .container { max-width: 1280px; margin: 0 auto; }
    header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; }
    .header-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
    h1 { font-size: 1.8rem; font-weight: 700; color: var(--heading); display: flex; align-items: center; gap: 0.6rem; }
    .tagline { color: var(--text-muted); font-size: 0.95rem; margin-top: 0.4rem; }
    .gh-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--card-bg);
      color: var(--heading);
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.9rem;
      text-decoration: none;
      transition: all 0.2s;
    }
    .gh-link:hover { border-color: var(--accent); color: var(--accent); }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .stat-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.25rem; }
    .stat-value { font-size: 1.6rem; font-weight: 700; color: var(--heading); font-family: 'JetBrains Mono', monospace; }
    .stat-sub { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }

    /* CLI Submission Box */
    .cli-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 2rem;
    }
    .cli-box h3 { font-size: 1rem; color: var(--heading); margin-bottom: 0.5rem; }
    .cli-box p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem; }
    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--border);
      padding: 0.85rem 1rem;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: var(--accent-green);
      overflow-x: auto;
      user-select: all;
    }

    /* Leaderboard Table */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    th {
      background: #11151c;
      padding: 0.85rem 1rem;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
      font-size: 0.8rem;
      text-transform: uppercase;
    }
    td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid #21262d;
      white-space: nowrap;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #1c2128; }
    .num { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    .col-rank { width: 50px; text-align: center; }
    .rank { font-weight: 700; font-family: 'JetBrains Mono', monospace; }
    .rank.gold { color: #f2cc60; }
    .rank.silver { color: #c9d1d9; }
    .rank.bronze { color: #d99b66; }
    .rank.default { color: var(--text-muted); font-size: 0.85rem; }
    .cpu-name { font-weight: 600; color: var(--heading); }
    .system-sub { font-size: 0.75rem; color: var(--text-muted); }
    .col-score { color: var(--accent); font-size: 1rem; }
    .badge-arch {
      background: #1f242c;
      border: 1px solid #363d47;
      color: #9cdcfe;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .badge-simd {
      background: #19221b;
      border: 1px solid #234228;
      color: #7ee787;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.7rem;
      font-family: 'JetBrains Mono', monospace;
    }
    footer {
      margin-top: 3rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      padding-top: 1.5rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-top">
        <div>
          <h1>🚀 OpenRAR RARMark v2.0 Leaderboard</h1>
          <div class="tagline">Real-time hardware compression benchmarks & community submissions running on Cloudflare Workers + D1</div>
        </div>
        <a class="gh-link" href="https://github.com/geometric-dev/openrar" target="_blank" rel="noopener">
          <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          geometric-dev/openrar
        </a>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">Total Submissions</div>
        <div class="stat-value">${stats.totalSubmissions}</div>
        <div class="stat-sub">Cryptographically verified</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Top RARMark Score</div>
        <div class="stat-value">${stats.topScore.toLocaleString()}</div>
        <div class="stat-sub">${escapeHtml(stats.topCpu)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Average Score</div>
        <div class="stat-value">${stats.avgScore.toLocaleString()}</div>
        <div class="stat-sub">All architectures</div>
      </div>
    </div>

    <div class="cli-box">
      <h3>Submit Your Machine via CLI</h3>
      <p>Run the native OpenRAR benchmark with JSON output and pipe directly to the ingestion API:</p>
      <div class="code-block">openrar b --json | curl -s -X POST -H "Content-Type: application/json" -d @- https://benchmarks.openrar.dev/api/submit</div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-rank">Rank</th>
            <th>Processor / System</th>
            <th>Arch</th>
            <th>Threads</th>
            <th>Vector SIMD</th>
            <th style="text-align: right">Memory BW</th>
            <th style="text-align: right">ST Compress</th>
            <th style="text-align: right">MT Compress</th>
            <th style="text-align: right">Parallel Decompress</th>
            <th style="text-align: right">RARMark Score</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-muted);">No verified submissions found yet. Run the command above to be first!</td></tr>'}
        </tbody>
      </table>
    </div>

    <footer>
      <p>Powered by <strong>Cloudflare Workers</strong> &bull; <strong>Cloudflare D1</strong> (Edge SQLite) &bull; Synchronized periodically with <a href="https://github.com/geometric-dev/openrar/blob/v2/BENCHMARKS.md">BENCHMARKS.md</a></p>
      <p style="margin-top: 0.4rem;">API: <code>POST /api/submit</code> &bull; <code>GET /api/leaderboard</code> &bull; <code>GET /api/export</code> &bull; <code>GET /api/stats</code></p>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

