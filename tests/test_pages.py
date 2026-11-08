"""Check HTML structure, JavaScript runtime errors, and direct page access."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

import html5lib
import pytest
import requests
from playwright.sync_api import Page

from scripts.testing import PROJECT_ROOT


class DocumentParser(HTMLParser):
    """Collect document element names and IDs for static HTML assertions."""

    def __init__(self) -> None:
        """Create empty sets used by the HTML parser callbacks."""
        super().__init__(convert_charrefs=True)
        self.elements: set[str] = set()
        self.ids: set[str] = set()
        self.parse_error: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Add each encountered element and its non-empty ID to the collections."""
        self.elements.add(tag)
        self.ids.update(value for name, value in attrs if name == "id" and value)


def application_pages() -> list[Path]:
    """Return every authored page that the static and browser checks exercise."""
    return [PROJECT_ROOT / "index.html", *sorted((PROJECT_ROOT / "html").rglob("*.html"))]


def test_all_html_pages_parse_as_documents() -> None:
    """Require each application page to have a valid HTML document structure."""
    failures: list[str] = []
    for path in application_pages():
        source = path.read_text(encoding="utf-8")
        parser = html5lib.HTMLParser(strict=False)
        parser.parse(source)
        document = DocumentParser()
        document.feed(source)
        if not {"html", "head", "body"}.issubset(document.elements):
            failures.append(f"{path.relative_to(PROJECT_ROOT)} is missing html/head/body")
        if parser.errors:
            failures.extend(
                f"{path.relative_to(PROJECT_ROOT)}:{position[0]} {code}"
                for position, code, _details in parser.errors
            )
    assert not failures, "\n".join(failures)


@pytest.mark.runtime
def test_every_application_page_is_reachable(base_url: str) -> None:
    """Request every page directly and ensure it responds with an HTML document."""
    failures: list[str] = []
    root_url = base_url.rstrip("/") + "/"
    for path in application_pages():
        url = root_url + path.relative_to(PROJECT_ROOT).as_posix()
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            if "text/html" not in response.headers.get("content-type", ""):
                failures.append(f"{url} did not return HTML")
        except requests.RequestException as error:
            failures.append(f"{url}: {error}")
    assert not failures, "\n".join(failures)


@pytest.mark.runtime
def test_pages_load_without_unexpected_browser_errors(
    base_url: str,
    page: Page,
    expected_unauthenticated_logs: dict[str, str],
) -> None:
    """Collect unexpected script, console, request, resource, and image errors.

    Known anonymous-access messages are filtered because the test intentionally
    does not authenticate against production services.
    """
    failures: list[str] = []
    for path in application_pages():
        route = path.relative_to(PROJECT_ROOT).as_posix()
        page_errors: list[str] = []
        console_errors: list[str] = []
        failed_requests: list[str] = []
        bad_responses: list[str] = []
        page_error_handler = lambda error: page_errors.append(str(error))
        console_handler = lambda message: console_errors.append(message.text) if message.type == "error" else None
        request_handler = lambda request: failed_requests.append(request.url) if request.url.startswith(base_url) else None
        response_handler = lambda response: bad_responses.append(
            f"HTTP {response.status}: {response.url}"
        ) if response.url.startswith(base_url) and response.status >= 400 else None
        page.on("pageerror", page_error_handler)
        page.on("console", console_handler)
        page.on("requestfailed", request_handler)
        page.on("response", response_handler)
        response = page.goto(f"{base_url}/{route}", wait_until="domcontentloaded")
        if response is None or response.status >= 400:
            failures.append(f"{route} did not return a successful document")
        if page.locator("html").count() != 1:
            failures.append(f"{route} did not render an HTML document")

        expected_log = expected_unauthenticated_logs.get(route)
        unexpected_logs = [
            message for message in console_errors
            if not (expected_log and message.startswith(expected_log))
        ]
        failures.extend(f"{route} JavaScript error: {error}" for error in page_errors)
        failures.extend(f"{route} console error: {error}" for error in unexpected_logs)
        failures.extend(f"{route} failed request: {url}" for url in failed_requests)
        failures.extend(f"{route} resource error: {error}" for error in bad_responses)
        broken_images = page.locator("img").evaluate_all(
            "(images) => images.filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src)"
        )
        failures.extend(
            f"{route} broken image: {source}"
            for source in broken_images
        )
        page.remove_listener("pageerror", page_error_handler)
        page.remove_listener("console", console_handler)
        page.remove_listener("requestfailed", request_handler)
        page.remove_listener("response", response_handler)

    assert not failures, "\n".join(failures)
