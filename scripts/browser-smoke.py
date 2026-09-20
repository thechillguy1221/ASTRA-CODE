from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5173"
PUBLIC_ROUTES = [
    "/",
    "/pricing",
    "/features/agent",
    "/compare/cursor",
    "/signup",
    "/account/devices",
]


def assert_no_horizontal_overflow(page, width: int) -> None:
    page.set_viewport_size({"width": width, "height": 900})
    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    overflow = page.evaluate(
        "document.documentElement.scrollWidth > window.innerWidth + 1"
    )
    assert not overflow, f"horizontal overflow at {width}px"


def exercise(browser_name: str, browser_type) -> None:
    try:
        browser = browser_type.launch(headless=True)
    except Exception as error:
        print(f"[BROWSER-BLOCKED] {browser_name}: {error}")
        return

    try:
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        for route in PUBLIC_ROUTES:
            page.goto(f"{BASE_URL}{route}", wait_until="networkidle")
            assert "Astra Code" in page.title(), f"missing Astra Code title on {route}"
            assert page.locator("h1").count() == 1, f"expected one h1 on {route}"

        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.get_by_role("button", name="Download Astra").first.click()
        assert page.url.endswith("/download/windows"), "CTA navigation did not update history"
        assert page.get_by_text("Windows 10/11 x64").count() > 0

        for width in (320, 360, 390, 768, 1280):
            assert_no_horizontal_overflow(page, width)

        print(f"[BROWSER-PASS] {browser_name}: routes, CTA, metadata, responsive overflow")
    finally:
        browser.close()


with sync_playwright() as playwright:
    exercise("chromium", playwright.chromium)
    exercise("firefox", playwright.firefox)
    exercise("webkit", playwright.webkit)
