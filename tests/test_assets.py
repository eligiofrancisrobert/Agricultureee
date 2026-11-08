"""Validate local resource paths, duplicate IDs, and CSS syntax."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
import tinycss2

from scripts.testing import PROJECT_ROOT


class ResourceParser(HTMLParser):
    """Collect IDs, local resource references, and client-side hash routes."""

    def __init__(self) -> None:
        """Initialize the collections populated while parsing HTML start tags."""
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, str]] = []
        self.ids: list[str] = []
        self.client_routes: set[str] = set()

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Record IDs and resource links, including hash-based dashboard routes."""
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        if "data-view" in attributes or "data-sub" in attributes:
            route = attributes.get("href", "")
            if route.startswith("#"):
                self.client_routes.add(route[1:])
        for attribute in ("src", "href"):
            value = attributes.get(attribute)
            if value:
                self.references.append((attribute, value))


def html_files() -> list[Path]:
    """Return the homepage and all authored application HTML pages."""
    return [PROJECT_ROOT / "index.html", *sorted((PROJECT_ROOT / "html").rglob("*.html"))]


def is_local_reference(value: str, base_url: str) -> bool:
    """Tell whether resolving a reference keeps it on the tested site's origin."""
    parsed = urlparse(urljoin(base_url, value))
    return parsed.scheme in {"http", "https"} and parsed.netloc == urlparse(base_url).netloc


def test_local_html_references_resolve_from_website_root(base_url: str) -> None:
    """Check local href/src targets and same-page fragments against the site."""
    failures: list[str] = []
    root_url = base_url.rstrip("/") + "/"
    for html_file in html_files():
        relative = html_file.relative_to(PROJECT_ROOT).as_posix()
        source_url = urljoin(root_url, relative)
        document = html_file.read_text(encoding="utf-8")
        parser = ResourceParser()
        parser.feed(document)
        for attribute, value in parser.references:
            target_url = urljoin(source_url, value)
            if not is_local_reference(value, source_url):
                continue
            target_parts = urlparse(target_url)
            if target_parts.fragment in parser.client_routes:
                continue
            target_url = target_parts._replace(fragment="").geturl()
            try:
                response = requests.get(target_url, timeout=5)
                response.raise_for_status()
            except requests.RequestException as error:
                failures.append(f"{relative} {attribute}={value!r}: {error}")
                continue
            if target_parts.fragment and target_url == source_url:
                target_parser = ResourceParser()
                target_parser.feed(document)
                if target_parts.fragment not in target_parser.ids:
                    failures.append(f"{relative} {attribute}={value!r}: fragment does not exist")
    assert not failures, "\n".join(failures)


def test_stylesheets_have_no_parse_errors(base_url: str) -> None:
    """Parse every authored stylesheet and verify its local url() assets exist."""
    failures: list[str] = []
    root_url = base_url.rstrip("/") + "/"
    for stylesheet in sorted((PROJECT_ROOT / "css").rglob("*.css")):
        source = stylesheet.read_text(encoding="utf-8")
        for error in tinycss2.parse_stylesheet(source, skip_comments=True, skip_whitespace=True):
            if error.type == "error":
                failures.append(f"{stylesheet.relative_to(PROJECT_ROOT)}:{error.source_line}: {error.message}")
        for match in re.finditer(r"url\(\s*(['\"]?)(.*?)\1\s*\)", source, re.IGNORECASE):
            value = match.group(2).strip()
            if not value or value.startswith(("data:", "http:", "https:", "//", "#")):
                continue
            css_url = urljoin(root_url, stylesheet.relative_to(PROJECT_ROOT).as_posix())
            target_url = urljoin(css_url, value)
            try:
                response = requests.get(target_url, timeout=5)
                response.raise_for_status()
            except requests.RequestException:
                failures.append(f"{stylesheet.relative_to(PROJECT_ROOT)} url({value!r})")
    assert not failures, "\n".join(failures)


def test_application_pages_have_no_duplicate_ids() -> None:
    """Ensure each page uses unique IDs, which browser scripts rely on for lookup."""
    failures: list[str] = []
    for html_file in html_files():
        parser = ResourceParser()
        parser.feed(html_file.read_text(encoding="utf-8"))
        seen: set[str] = set()
        for element_id in parser.ids:
            if element_id in seen:
                failures.append(f"{html_file.relative_to(PROJECT_ROOT)} duplicate id={element_id!r}")
            seen.add(element_id)
    assert not failures, "\n".join(failures)
