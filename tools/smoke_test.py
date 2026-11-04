#!/usr/bin/env python3
"""Headless smoke test for Powder & Sail.
Usage: python tools/smoke_test.py [--shot NAME] [--secs N] [--tests]
Serves the repository root on :8123, loads the game, collects console
errors/warnings, waits N seconds of gameplay, screenshots, optionally runs
the browser test suite and reports pass/fail counts. Screenshots go to
tools/out/<NAME>.png.
"""
import argparse, http.server, socketserver, threading, functools, sys, json, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "tools", "out")
PORT = 8123

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", default="shot")
    ap.add_argument("--secs", type=float, default=6.0)
    ap.add_argument("--tests", action="store_true")
    args = ap.parse_args()

    httpd = serve()
    errors, warnings, logs = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader",
                                          "--enable-unsafe-swiftshader", "--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 810})
        page.on("console", lambda m: (errors if m.type == "error" else
                                      warnings if m.type == "warning" else logs
                                      ).append(m.text))
        page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))

        page.goto(f"http://localhost:{PORT}/frontend/", wait_until="domcontentloaded")
        # dismiss tutorial overlay if present so the play-field is visible
        page.wait_for_timeout(2500)
        for sel in ["#tut-skip", "#tutorial-skip", "[data-tut-skip]"]:
            try:
                if page.locator(sel).count():
                    page.locator(sel).first.click(timeout=500)
                    break
            except Exception:
                pass
        page.wait_for_timeout(int(args.secs * 1000))
        os.makedirs(OUT, exist_ok=True)
        page.screenshot(path=os.path.join(OUT, f"{args.shot}.png"))

        # quick state probe
        try:
            probe = page.evaluate("""() => {
                const g = window._game; if (!g) return {game:false};
                return {game:true, ships: g._state.allShips.length,
                        alive: g._state.allShips.filter(s=>s.alive).length,
                        islands: g._islands.length,
                        composer: !!(g._renderer && g._renderer.composerEnabled)};
            }""")
        except Exception as e:
            probe = {"probe_error": str(e)}

        test_summary = None
        if args.tests:
            tp = browser.new_page()
            terr = []
            tp.on("pageerror", lambda e: terr.append(str(e)))
            tp.goto(f"http://localhost:{PORT}/test/", wait_until="domcontentloaded")
            tp.wait_for_timeout(6000)
            test_summary = tp.evaluate("""() => {
                const b = document.body.innerText;
                const passes = (b.match(/✓|PASS/g)||[]).length;
                const fails  = (b.match(/✗|FAIL/g)||[]).length;
                const sum = document.querySelector('#summary, .summary');
                return {passes, fails, summary: sum ? sum.innerText : b.slice(-400), errors: null};
            }""")
            test_summary["page_errors"] = terr
        browser.close()
    httpd.shutdown()

    print(json.dumps({"console_errors": errors[:20], "warnings": warnings[:8],
                      "probe": probe, "tests": test_summary}, indent=1, ensure_ascii=False))
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    main()
