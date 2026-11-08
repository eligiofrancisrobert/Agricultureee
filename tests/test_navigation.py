"""Exercise the homepage's real navigation and client-side controls."""

from __future__ import annotations

import json

import pytest
from playwright.sync_api import Page, expect


pytestmark = pytest.mark.functional


def test_faq_search_and_accordion_work(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/index.html")
    question = page.locator(".faq-question").first
    question.click()
    expect(question).to_have_attribute("aria-expanded", "true")
    expect(question.locator("xpath=..").locator(".faq-answer")).to_be_visible()

    page.locator("#faqSearch").fill("zz-no-matching-question")
    expect(page.locator("#faqEmpty")).to_be_visible()
    expect(page.locator(".faq-item:visible")).to_have_count(0)
    page.locator("#resetFaq").click()
    expect(page.locator("#faqEmpty")).to_be_hidden()


def test_theme_persists_and_carousel_moves(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/index.html")
    toggle = page.locator("#themeToggle")
    toggle.click()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    expect(toggle).to_have_attribute("aria-pressed", "true")
    assert page.evaluate("localStorage.getItem('theme')") == "dark"
    page.reload()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")

    page.locator(".carousel-btn.next").click()
    expect(page.locator(".carousel-track")).to_have_attribute("style", "transform: translateX(-100%);")


def test_contact_form_rejects_empty_required_fields(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/index.html")
    form = page.locator("#contactForm")
    assert form.evaluate("(element) => element.checkValidity()") is False
    assert form.locator(":invalid").count() > 0
    form.locator(".contact-submit").click()
    assert form.evaluate("(element) => element.checkValidity()") is False


def test_contact_form_submits_to_isolated_stub(page: Page, base_url: str) -> None:
    submitted: list[dict[str, str]] = []

    def handle_contact_request(route) -> None:
        submitted.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body='{"success":true}')

    page.route("**/functions/v1/send-contact-message", handle_contact_request)
    page.goto(f"{base_url}/index.html")
    page.locator("#name").fill("Test Farmer")
    page.locator("#email").fill("farmer@example.test")
    page.locator("#subject").fill("Question")
    page.locator("#message").fill("How do I get started?")

    dialogs: list[str] = []

    def accept_confirmation(dialog) -> None:
        dialogs.append(dialog.message)
        dialog.accept()

    page.on("dialog", accept_confirmation)
    page.locator(".contact-submit").click()

    expect(page.locator("#name")).to_have_value("")
    expect(page.locator(".contact-submit")).to_be_enabled()
    assert dialogs == ["Thank you! Your message has been sent to Tanikala."]
    assert submitted == [{
        "name": "Test Farmer",
        "email": "farmer@example.test",
        "subject": "Question",
        "message": "How do I get started?",
    }]


def test_login_form_rejects_missing_credentials(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/html/login.html")
    form = page.locator("#loginForm")
    assert form.evaluate("(element) => element.checkValidity()") is False
    page.locator("#loginButton").click()
    assert form.evaluate("(element) => element.checkValidity()") is False
    expect(page).to_have_url(f"{base_url}/html/login.html")


def test_mobile_menu_and_homepage_links_navigate(page: Page, base_url: str) -> None:
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(f"{base_url}/index.html")
    page.locator("#menu-icon").click()
    expect(page.locator(".navigations")).to_have_class("navigations active")
    page.locator("#services").click()
    expect(page).to_have_url(f"{base_url}/html/service.html")

    page.goto(f"{base_url}/index.html")
    page.locator("#get-started").click()
    expect(page).to_have_url(f"{base_url}/html/login.html")
