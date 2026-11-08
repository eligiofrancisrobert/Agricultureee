"""Shared Python utilities for local static serving and runtime checks."""

from __future__ import annotations

import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from urllib.parse import urlparse

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_ROOT / "reports"


class QuietStaticHandler(SimpleHTTPRequestHandler):
    """Serve the existing static site without noisy per-request logs."""

    def log_message(self, _format: str, *_args: object) -> None:
        pass


def create_static_server() -> ThreadingHTTPServer:
    """Create an ephemeral loopback server rooted at the repository directory.

    The operating system selects an available port, avoiding conflicts with
    developer services; the returned server is not started until its caller
    launches ``serve_forever``.
    """
    handler = partial(QuietStaticHandler, directory=str(PROJECT_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    return server


@contextmanager
def local_server() -> Iterator[str]:
    """Yield the URL of a test-owned server and always shut that server down.

    The server runs on a daemon thread while the caller exercises the site.
    Cleanup is limited to this instance and joins its thread after closing the
    listening socket, including when a test raises an exception.
    """
    server = create_static_server()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def normalize_base_url(value: str) -> str:
    """Validate an absolute HTTP(S) URL and remove trailing slash characters.

    Args:
        value: Candidate application base URL.

    Returns:
        The same URL without a trailing slash.

    Raises:
        ValueError: If the value has no HTTP(S) scheme or network location.
    """
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Expected an absolute http(s) URL, received: {value!r}")
    return value.rstrip("/")


def wait_for_url(url: str, timeout: float = 30.0) -> requests.Response:
    """Poll a site until it returns a successful response or the deadline expires.

    Individual requests have a short timeout so an unavailable server does not
    consume the full readiness window in one attempt. Network and non-success
    HTTP responses are retried; exhaustion raises ``ConnectionError`` with the
    most recent failure detail.
    """
    url = normalize_base_url(url)
    deadline = datetime.now(timezone.utc).timestamp() + timeout
    last_error = "No response received"
    while datetime.now(timezone.utc).timestamp() < deadline:
        try:
            response = requests.get(url, timeout=3)
            if response.ok:
                return response
            last_error = f"HTTP {response.status_code}"
        except requests.RequestException as error:
            last_error = str(error)
        threading.Event().wait(0.5)
    raise ConnectionError(f"Application at {url} was not ready after {timeout:g}s: {last_error}")


def write_runtime_report(report: dict[str, object]) -> Path:
    """Persist the latest runtime-check result as formatted JSON.

    Args:
        report: JSON-serializable run metadata and outcome.

    Returns:
        The path to ``reports/runtime-check.json``.
    """
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / "runtime-check.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report_path


def configured_base_url() -> str | None:
    """Return a validated ``BASE_URL`` override, or ``None`` if unset."""
    value = os.environ.get("BASE_URL")
    return normalize_base_url(value) if value else None
