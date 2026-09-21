from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5174"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BASE_URL, wait_until="networkidle")
    assert page.title() == "Astra Code Admin"
    assert page.get_by_role("button", name="Sign in").count() == 1
    assert page.get_by_label("Email").count() == 1
    assert page.get_by_label("Password").count() == 1
    assert not page_errors, page_errors

    for width in (390, 768, 1280):
        page.set_viewport_size({"width": width, "height": 900})
        page.goto(BASE_URL, wait_until="networkidle")
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
        assert not overflow, f"horizontal overflow at {width}px"

    browser.close()
    print("[BROWSER-PASS] admin: login boundary, console errors, responsive overflow")
