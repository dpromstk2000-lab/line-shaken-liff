"""DPRO CAR02 R113 — browser-only QA of R112 synthetic public demo.

Runs only known repo-local HTML/ESM files. No customer data, secrets, production endpoints,
Storage/API communication, writes or deployments. --embedded is for environments where
localhost navigation is blocked; official CI MUST use --http for real ES module loading.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import json
import sys

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
FILES = {
    '/CAR02_R112_QUARANTINE_REVIEW_DEMO.html': ('CAR02_R112_QUARANTINE_REVIEW_DEMO.html', 'text/html; charset=utf-8'),
    '/car02-r112-review-demo-browser.mjs': ('car02-r112-review-demo-browser.mjs', 'text/javascript; charset=utf-8'),
    '/car02-r112-review-demo-model.mjs': ('car02-r112-review-demo-model.mjs', 'text/javascript; charset=utf-8'),
}
CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

class SafeFixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        if path not in FILES:
            self.send_error(404); return
        filename, mime = FILES[path]
        payload = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

    def log_message(self, *_):
        return

def inspect_page(browser, name, width, height, origin, embedded, screenshots):
    context = browser.new_context(viewport={'width':width,'height':height},
                                  device_scale_factor=1, accept_downloads=False,
                                  service_workers='block')
    errors = []
    rejected = []
    page = context.new_page()
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    if embedded:
        html = (ROOT / FILES['/CAR02_R112_QUARANTINE_REVIEW_DEMO.html'][0]).read_text()
        html = html.replace('<script type="module" src="./car02-r112-review-demo-browser.mjs"></script>', '')
        model = (ROOT / FILES['/car02-r112-review-demo-model.mjs'][0]).read_text().replace('export ', '')
        script = '\n'.join(line for line in (ROOT / FILES['/car02-r112-review-demo-browser.mjs'][0]).read_text().splitlines() if not line.startswith('import '))
        page.set_content(html)
        page.add_script_tag(content=model+'\n'+script)
    else:
        def safe_route(route):
            url = route.request.url
            if url.startswith(origin+'/'):
                route.continue_()
            else:
                rejected.append(url)
                route.abort()
        context.route('**/*', safe_route)
        page.goto(origin+'/CAR02_R112_QUARANTINE_REVIEW_DEMO.html', wait_until='load', timeout=25000)
    try:
        expect(page.locator('#stats-total')).to_have_text('11')
        expect(page.locator('#stats-escalated')).to_have_text('4')
        expect(page.locator('#stats-unreviewed')).to_have_text('5')
        expect(page.locator('#stats-reviewed')).to_have_text('6')
        expect(page.locator('.case')).to_have_count(5)
        expect(page.locator('#page-label')).to_have_text('1 / 3 ページ')
        assert page.locator('text=架空データ').count() > 0
        assert page.get_by_text('本番未接続').count() > 0
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'R113_HORIZONTAL_OVERFLOW'
        page.screenshot(path=str(screenshots/f'{name}_initial.png'), full_page=True, animations='disabled')

        page.locator('#next').click()
        expect(page.locator('#page-label')).to_have_text('2 / 3 ページ')
        expect(page.locator('.case')).to_have_count(5)
        page.locator('#next').click()
        expect(page.locator('#page-label')).to_have_text('3 / 3 ページ')
        expect(page.locator('.case')).to_have_count(1)
        assert page.locator('#next').is_disabled()

        page.locator('button[data-filter="escalated"]').click()
        expect(page.locator('#result-count')).to_have_text('該当 4 件')
        expect(page.locator('.case')).to_have_count(4)
        expect(page.locator('button[data-filter="escalated"]')).to_have_attribute('aria-pressed','true')
        page.locator('#reason').select_option('ACK_LOST')
        expect(page.locator('#result-count')).to_have_text('該当 1 件')

        page.locator('#reset').click()
        page.locator('button[data-filter="unreviewed"]').click()
        expect(page.locator('#result-count')).to_have_text('該当 5 件')
        page.locator('#reset').click()
        exact='00000000-0000-4000-8000-000000000005'
        page.locator('#search').fill(exact)
        expect(page.locator('#result-count')).to_have_text('該当 1 件')
        expect(page.locator('.case')).to_have_count(1)
        page.locator('button.details').click()
        expect(page.locator('button.details')).to_have_attribute('aria-expanded','true')
        expect(page.locator('.detail-panel')).to_have_count(1)
        assert exact in page.locator('.detail-panel').inner_text()
        page.locator('button.details').click()
        expect(page.locator('.detail-panel')).to_have_count(0)
        page.locator('#search').fill('nonexistent-fixture-id')
        expect(page.locator('#result-count')).to_have_text('該当 0 件')
        assert page.get_by_text('該当する案件はありません。').count() == 1
        page.locator('#reset').click()
        expect(page.locator('#result-count')).to_have_text('該当 11 件')
        assert not errors, 'R113_BROWSER_ERRORS: '+json.dumps(errors,ensure_ascii=False)
        assert not rejected, 'R113_EXTERNAL_REQUESTS_DENIED: '+json.dumps(rejected)
        print(f'R113_{name.upper()}_BROWSER_INTERACTION_PASS width={width} rows=11 no_overflow=true external_requests=0')
    except Exception:
        page.screenshot(path=str(screenshots/f'{name}_failure.png'), full_page=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--embedded', action='store_true', help='local fallback when browser blocks localhost navigation; not valid as official CI')
    parser.add_argument('--executable-path', default=None)
    parser.add_argument('--out', default='r113-browser-evidence')
    args = parser.parse_args()
    shots = (ROOT / args.out).resolve(); shots.mkdir(parents=True,exist_ok=True)
    server = None; thread = None; origin = None
    try:
        if not args.embedded:
            server = ThreadingHTTPServer(('127.0.0.1',0), SafeFixtureHandler)
            thread = Thread(target=server.serve_forever,daemon=True); thread.start()
            origin = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=args.executable_path, args=['--no-sandbox'])
            try:
                for name,w,h in [('desktop',1280,840),('mobile',375,800),('narrow',320,700)]:
                    inspect_page(browser,name,w,h,origin,args.embedded,shots)
            finally: browser.close()
        print('R113_BROWSER_SCREENSHOT_PROOFS_READY')
        print('R113_BROWSER_EMBEDDED_LOCAL_PASS' if args.embedded else 'R113_REAL_HTTP_MODULE_BROWSER_QA_PASS')
    finally:
        if server: server.shutdown();server.server_close()

if __name__=='__main__':
    main()
