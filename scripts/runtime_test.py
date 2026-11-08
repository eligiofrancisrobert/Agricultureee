"""Wait for a running site and execute runtime/browser checks against it."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.testing import normalize_base_url, wait_for_url, write_runtime_report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=None,
        help="Application URL. Defaults to BASE_URL or http://127.0.0.1:5500.",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="Server readiness timeout in seconds.")
    args, pytest_args = parser.parse_known_args()
    url = normalize_base_url(args.url or os.environ.get("BASE_URL", "http://127.0.0.1:5500"))
    started_at = datetime.now(timezone.utc)

    try:
        response = wait_for_url(url, timeout=args.timeout)
    except (ConnectionError, ValueError) as error:
        write_runtime_report({
            "url": url,
            "started_at": started_at.isoformat(),
            "status": "failed",
            "error": str(error),
        })
        print(str(error), file=sys.stderr)
        return 1

    print(f"Application is reachable at {url} (HTTP {response.status_code})")
    exit_code = int(pytest.main([
        "tests/test_pages.py",
        "tests/test_navigation.py",
        "tests/test_responsive.py",
        "--base-url",
        url,
        *pytest_args,
    ]))
    write_runtime_report({
        "url": url,
        "http_status": response.status_code,
        "browser": "Chromium",
        "python": sys.version.split()[0],
        "started_at": started_at.isoformat(),
        "duration_seconds": (datetime.now(timezone.utc) - started_at).total_seconds(),
        "status": "passed" if exit_code == pytest.ExitCode.OK else "failed",
        "pytest_exit_code": exit_code,
    })
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
