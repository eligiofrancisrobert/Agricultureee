"""Measure public page overflow and key control visibility at target sizes."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

PUBLIC_PAGES = (
    "index.html",
    "html/service.html",
    "html/login.html",
    "html/signup.html",
    "html/forgot-password.html",
    "html/reset-password.html",
)

VIEWPORTS = (
    ("mobile", 375, 812),
    ("tablet", 768, 1024),
    ("laptop", 1366, 768),
    ("desktop", 1920, 1080),
)


@pytest.mark.responsive
@pytest.mark.parametrize(("name", "width", "height"), VIEWPORTS)
@pytest.mark.parametrize("route", PUBLIC_PAGES)
def test_public_pages_fit_supported_viewports(
    page: Page,
    base_url: str,
    name: str,
    width: int,
    height: int,
    route: str,
) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"{base_url}/{route}", wait_until="domcontentloaded")
    dimensions = page.evaluate(
        """() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth
        })"""
    )
    assert dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1, (
        f"{route} at {name} has horizontal overflow: "
        f"{dimensions['scrollWidth']}px > {dimensions['clientWidth']}px"
    )
    if route == "index.html":
        expect(page.locator("#themeToggle")).to_be_visible()
    else:
        expect(page.locator("body")).to_be_visible()
