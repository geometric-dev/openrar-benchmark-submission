import { Env } from './types';
import { getExportData, markSynced } from './db';

export async function triggerGitHubDispatch(
  env: Env,
  eventType = 'sync_benchmarks',
  clientPayload: Record<string, any> = {}
): Promise<{ success: boolean; message: string; status?: number }> {
  if (!env.GITHUB_TOKEN) {
    return {
      success: false,
      message: 'GITHUB_TOKEN secret is not set in Cloudflare Worker environment variables',
    };
  }

  const repo = env.GITHUB_REPO || 'geometric-dev/openrar';
  const url = `https://api.github.com/repos/${repo}/dispatches`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'OpenRAR-Benchmark-CloudSync/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: clientPayload,
      }),
    });

    if (res.status === 204 || res.status === 200) {
      return { success: true, message: `Successfully triggered repository_dispatch for ${repo}`, status: res.status };
    }

    const errText = await res.text();
    return {
      success: false,
      message: `GitHub API error (${res.status}): ${errText}`,
      status: res.status,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to contact GitHub API: ${err.message}`,
    };
  }
}

export async function syncSubmissionsDirectlyToGitHub(
  env: Env
): Promise<{ success: boolean; syncedCount: number; message: string }> {
  if (!env.GITHUB_TOKEN) {
    return {
      success: false,
      syncedCount: 0,
      message: 'GITHUB_TOKEN secret is not set. Submissions remain queued in D1.',
    };
  }

  const repo = env.GITHUB_REPO || 'geometric-dev/openrar';
  const branch = env.GITHUB_TARGET_BRANCH || 'v2';
  const pending = await getExportData(env.DB, { syncOnlyPending: true, limit: 20 });

  if (pending.length === 0) {
    return {
      success: true,
      syncedCount: 0,
      message: 'No pending submissions to sync.',
    };
  }

  const syncedIds: string[] = [];

  for (const item of pending) {
    const filePath = `benchmarks/submissions/${item.slug}.json`;
    const fileContent = JSON.stringify(item, null, 2) + '\n';
    const contentBase64 = btoa(fileContent);

    // 1. Check if file already exists to get SHA for update
    let sha: string | undefined;
    try {
      const checkRes = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            'User-Agent': 'OpenRAR-Benchmark-CloudSync/1.0',
          },
        }
      );
      if (checkRes.status === 200) {
        const fileInfo: any = await checkRes.json();
        sha = fileInfo.sha;
      }
    } catch {
      // Proceed without SHA for new file
    }

    // 2. Put file to repo
    const commitMsg = `benchmark: sync verified submission ${item.slug} (RARMark: ${item.results.rarmark_score})`;
    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'OpenRAR-Benchmark-CloudSync/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMsg,
        content: contentBase64,
        branch: branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (putRes.status === 200 || putRes.status === 201) {
      syncedIds.push(item.id);
    } else {
      const err = await putRes.text();
      console.error(`Failed to commit ${filePath}: ${err}`);
    }
  }

  if (syncedIds.length > 0) {
    await markSynced(env.DB, syncedIds);
    // Also trigger repository dispatch so openrar CI regenerates BENCHMARKS.md
    await triggerGitHubDispatch(env, 'benchmarks_updated', {
      synced_count: syncedIds.length,
    });
  }

  return {
    success: true,
    syncedCount: syncedIds.length,
    message: `Successfully synced ${syncedIds.length} benchmark(s) to ${repo} (${branch})`,
  };
}

