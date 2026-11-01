#!/usr/bin/env python3
"""
OpenRAR RARMark v2.0 Benchmark Submission Helper
Executes `openrar b --json` on the host machine and posts the cryptographically
verified benchmark payload to the Cloudflare Worker ingestion endpoint.

Usage:
  python scripts/submit_benchmark.py [--endpoint URL] [--openrar PATH] [--system NAME]
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error


def run_benchmark(openrar_bin: str = "openrar") -> dict:
    cmd = [openrar_bin, "b", "--json"]
    print(f"Executing: {' '.join(cmd)}")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except FileNotFoundError:
        print(f"Error: '{openrar_bin}' not found in PATH. Build OpenRAR or specify --openrar.", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error running benchmark: {e.stderr}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(res.stdout)
        return data
    except json.JSONDecodeError as e:
        print(f"Failed to parse benchmark JSON output:\n{res.stdout}", file=sys.stderr)
        sys.exit(1)


def submit_benchmark(data: dict, endpoint: str) -> dict:
    url = endpoint.rstrip("/")
    if not url.endswith("/api/submit"):
        url = f"{url}/api/submit"

    payload_bytes = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload_bytes,
        headers={
            "Content-Type": "application/json",
            "User-Agent": f"openrar-client/{data.get('version', '2.0.1')}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode("utf-8")
            return json.loads(resp_body)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        print(f"HTTP Error {e.code}: {err_msg}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Connection failed: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Submit OpenRAR benchmark to cloud leaderboard")
    parser.add_argument(
        "--endpoint",
        default=os.getenv("OPENRAR_BENCHMARK_ENDPOINT", "https://benchmark.openrar.workers.dev/api/submit"),
        help="Submission endpoint URL",
    )
    parser.add_argument("--openrar", default="openrar", help="Path to openrar executable")
    parser.add_argument("--system", default=None, help="System name / description (e.g. 'Desktop Custom Watercooled')")
    parser.add_argument("--dry-run", action="store_true", help="Print payload without sending")
    args = parser.parse_args()

    data = run_benchmark(args.openrar)

    if args.system:
        data["system"] = args.system

    print("\n--- Benchmark Summary ---")
    print(f"CPU:         {data.get('cpu', {}).get('brand')}")
    print(f"Threads:     {data.get('config', {}).get('threads')}")
    if data.get("results", {}).get("memory_bandwidth_gbps"):
        print(f"Memory BW:   {data['results']['memory_bandwidth_gbps']:.1f} GB/s")
    print(f"Single-Core: {data.get('results', {}).get('st_compress_kbps', 0)/1024:.1f} MB/s")
    print(f"Multi-Core:  {data.get('results', {}).get('mt_compress_kbps', 0)/1024:.1f} MB/s")
    print(f"Parallel De: {data.get('results', {}).get('mt_decompress_kbps', 0)/1024:.1f} MB/s")
    print(f"RARMark v2:  {data.get('results', {}).get('rarmark_score', 0):,}")
    print(f"Verified:    {data.get('results', {}).get('decompression_verified')}")

    if args.dry_run:
        print("\nDry-run specified. Payload not submitted.")
        return

    print(f"\nSubmitting to {args.endpoint}...")
    res = submit_benchmark(data, args.endpoint)
    print(f"Success! {res.get('message')}")
    print(f"Submission ID: {res.get('id')}")
    print(f"Current Rank:  #{res.get('rank')}")


if __name__ == "__main__":
    main()
