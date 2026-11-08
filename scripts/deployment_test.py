"""Run non-destructive HTTP and browser smoke tests against a deployment."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.runtime_test import main as run_runtime_tests


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Deployed application URL (HTTP or HTTPS).")
    parser.add_argument("--timeout", type=float, default=30.0, help="Deployment readiness timeout in seconds.")
    args = parser.parse_args()

    sys.argv = [sys.argv[0], "--url", args.url, "--timeout", str(args.timeout)]
    return run_runtime_tests()


if __name__ == "__main__":
    raise SystemExit(main())
