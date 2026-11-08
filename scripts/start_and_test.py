"""Start an isolated local server, run pytest, and stop only that server."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.testing import local_server


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=os.environ.get("BASE_URL"),
        help="Test an existing server instead of starting one.",
    )
    parser.add_argument("pytest_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    if args.url:
        url = args.url.rstrip("/")
        print(f"Testing already-running application at {url}")
        return int(pytest.main(["tests", "--base-url", url, *args.pytest_args]))

    with local_server() as url:
        print(f"Started test-owned server at {url}")
        return int(pytest.main(["tests", "--base-url", url, *args.pytest_args]))


if __name__ == "__main__":
    raise SystemExit(main())
