"""Run the complete pytest suite, using a local site unless BASE_URL is set."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def main() -> int:
    arguments = sys.argv[1:] or ["tests"]
    return int(pytest.main(arguments, plugins=[]))


if __name__ == "__main__":
    raise SystemExit(main())
