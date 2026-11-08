"""Shared pytest options, app server, and isolated Playwright fixtures."""

from __future__ import annotations

import os
import re
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import pytest
import requests
from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from scripts.testing import PROJECT_ROOT, local_server, normalize_base_url

SUPABASE_MODULE_STUB = """
const result = { data: [], error: null };
const query = () => ({
  select() { return this }, insert() { return this }, update() { return this },
  delete() { return this }, upsert() { return this }, eq() { return this },
  neq() { return this }, in() { return this }, order() { return this },
  limit() { return this }, range() { return this }, match() { return this },
  filter() { return this }, is() { return this }, contains() { return this },
  single() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return Promise.resolve({ data: null, error: null }) },
  then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) }
});
const auth = {
  getUser: async () => ({ data: { user: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null }),
  signInWithPassword: async () => ({ data: null, error: null }),
  updateUser: async () => ({ data: null, error: null }),
  setSession: async () => ({ data: null, error: null })
};
export function createClient() {
  const channel = { on() { return this }, subscribe() { return this }, unsubscribe() {} };
  const storage = { from() { return {
    upload: async () => ({ data: null, error: null }),
    remove: async () => ({ data: null, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null })
  } } };
  return {
    auth, storage, from: query, rpc: async () => result,
    functions: { invoke: async () => result },
    channel: () => channel, removeChannel: () => Promise.resolve('ok')
  };
}
"""

EXPECTED_UNAUTHENTICATED_LOGS = {
    "html/pages/admin/assigned-warehouse-officers.html":
        "Failed to load Warehouse Officer assignments: Error: No authenticated user found.",
    "html/pages/warehouse-officer/warehouse-officer-dashboard.html":
        "Authentication failed: null",
}


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--base-url",
        action="store",
        default=os.environ.get("BASE_URL"),
        help="Test an already-running site at this URL instead of starting a local server.",
    )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[object]):
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)


@pytest.fixture(scope="session")
def base_url(pytestconfig: pytest.Config) -> Iterator[str]:
    configured_url = pytestconfig.getoption("--base-url")
    if configured_url:
        url = normalize_base_url(configured_url)
        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()
        except requests.RequestException as error:
            pytest.fail(f"Configured application URL {url} is unavailable: {error}")
        yield url
        return

    with local_server() as url:
        yield url


@pytest.fixture(scope="session")
def browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch(headless=True)
        yield instance
        instance.close()


@pytest.fixture
def context(browser: Browser, base_url: str) -> Iterator[BrowserContext]:
    context = browser.new_context(
        base_url=base_url,
        viewport={"width": 1366, "height": 768},
    )
    app_origin = urlparse(base_url).netloc

    def isolate_external(route) -> None:
        request_url = urlparse(route.request.url)
        if request_url.netloc == app_origin:
            route.continue_()
        elif request_url.netloc == "esm.sh" and request_url.path.startswith("/@supabase/"):
            route.fulfill(status=200, content_type="text/javascript", body=SUPABASE_MODULE_STUB)
        elif request_url.netloc == "cdnjs.cloudflare.com" and "font-awesome" in request_url.path:
            route.fulfill(
                status=200,
                content_type="text/css",
                body='.fa-bars::before{content:"Menu"}.fa-xmark::before{content:"X"}',
            )
        else:
            content_type = "text/css" if request_url.path.endswith(".css") else "text/javascript"
            route.fulfill(status=200, content_type=content_type, body="")

    context.route("**/*", isolate_external)
    try:
        yield context
    finally:
        context.close()


@pytest.fixture
def page(context: BrowserContext, request: pytest.FixtureRequest) -> Iterator[Page]:
    page = context.new_page()
    yield page
    report = getattr(request.node, "rep_call", None)
    if report and report.failed:
        screenshot_dir = PROJECT_ROOT / "test-results" / "screenshots"
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", request.node.nodeid)[:120]
        screenshot = screenshot_dir / f"{name}.png"
        page.screenshot(path=str(screenshot), full_page=True)
        print(f"Failure screenshot: {screenshot.relative_to(PROJECT_ROOT)}")
    page.close()


@pytest.fixture
def expected_unauthenticated_logs() -> dict[str, str]:
    return EXPECTED_UNAUTHENTICATED_LOGS
