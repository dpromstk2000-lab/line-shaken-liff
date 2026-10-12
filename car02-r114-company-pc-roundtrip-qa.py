"""CAR02 R114: local-only, synthetic, real-module browser check for R90->R91.
No production endpoints, secrets, DB writes, LINE, or release authorization.
Official test is run against the existing reviewed R90 and R91 files via GitHub Actions.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import json

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
FILES = {
    '/CAR02_R90_COMPANY_PC_RECORD.html': 'text/html; charset=utf-8',
    '/CAR02_R91_COMPANY_PC_TRIAGE.html': 'text/html; charset=utf-8',
    '/car02-staff-review-app-r90.mjs': 'text/javascript; charset=utf-8',
    '/car02-staff-review-model-r86.mjs': 'text/javascript; charset=utf-8',
    '/car02-r89-acceptance-model.mjs': 'text/javascript; charset=utf-8',
    '/car02-company-pc-record-r90.mjs': 'text/javascript; charset=utf-8',
    '/car02-r91-triage-app.mjs': 'text/javascript; charset=utf-8',
    '/car02-r91-triage-model.mjs': 'text/javascript; charset=utf-8',
}
CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

class SafeFixture(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        if path not in FILES:
            self.send_error(404); return
        payload = (ROOT / path.lstrip('/')).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', FILES[path])
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def log_message(self, *_):
        return

EXPECTED_STATES = {'ui_desktop': 'ok', 'booking_calendar': 'issue'}

def exercise(browser, name, width, height, origin, screenshots):
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  accept_downloads=True, service_workers='block')
    errors, forbidden = [], []
    def safe_route(route):
        u = route.request.url
        p = urlsplit(u)
        if u.startswith(origin + '/') and (p.path in FILES or p.path == '/favicon.ico'):
            route.continue_()
        else:
            forbidden.append(u)
            route.abort()
    context.route('**/*', safe_route)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    try:
        page.goto(origin + '/CAR02_R90_COMPANY_PC_RECORD.html', wait_until='load')
        page.locator('button[data-page="qa"]').click()
        expect(page.locator('select[data-qa-id]')).to_have_count(8)
        expect(page.locator('#qaProgress')).to_contain_text('未確認 8件')
        page.locator('#r90-ui_desktop').select_option('ok')
        page.locator('#r90-booking_calendar').select_option('issue')
        expect(page.locator('#qaProgress')).to_contain_text('問題なし 1件 / 要修正 1件 / 未確認 6件')
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'), 'R114_R90_HORIZONTAL_OVERFLOW'
        page.screenshot(path=str(screenshots / f'{name}_r90.png'), full_page=True)
        with page.expect_download() as outgoing:
            page.locator('#qaExport').click()
        downloaded = outgoing.value
        assert downloaded.suggested_filename.startswith('DPRO_CAR02_R90_PC_SELF_CHECK_')
        assert downloaded.suggested_filename.endswith('.json')
        saved = screenshots / f'{name}_synthetic_r90.json'
        downloaded.save_as(str(saved))
        payload = json.loads(saved.read_text(encoding='utf-8'))
        assert set(payload) == {'schema','source','generatedAt','states','releaseDecision','migrationDecision','productionReady'}
        assert payload['schema'] == 'DPRO_CAR02_R90_PC_SELF_CHECK_V1'
        assert payload['source'] == 'ISOLATED_UI_SELF_REPORT'
        assert len(payload['states']) == 8
        for key, value in EXPECTED_STATES.items():
            assert payload['states'][key] == value
        assert sorted(payload['states'].values()) == ['issue', 'ok'] + ['pending'] * 6
        assert payload['releaseDecision'] == 'NO_GO'
        assert payload['migrationDecision'] == 'HOLD'
        assert payload['productionReady'] is False
        # Verify R90 restores saved selections rather than simply exporting them.
        page.locator('#qaReset').click()
        expect(page.locator('#qaProgress')).to_contain_text('未確認 8件')
        page.locator('#qaImportFile').set_input_files(str(saved))
        expect(page.locator('#r90-ui_desktop')).to_have_value('ok')
        expect(page.locator('#r90-booking_calendar')).to_have_value('issue')

        page.goto(origin + '/CAR02_R91_COMPANY_PC_TRIAGE.html', wait_until='load')
        expect(page.locator('#pendingCount')).to_have_text('8')
        page.locator('#sourceFile').set_input_files(str(saved))
        expect(page.locator('#issueCount')).to_have_text('1')
        expect(page.locator('#pendingCount')).to_have_text('6')
        expect(page.locator('#okCount')).to_have_text('1')
        expect(page.locator('#totalCount')).to_have_text('8')
        expect(page.locator('.result-group h2').first).to_contain_text('要修正：1件')
        expect(page.locator('#nextTask')).to_contain_text('「要修正」')
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'), 'R114_R91_HORIZONTAL_OVERFLOW'
        page.screenshot(path=str(screenshots / f'{name}_r91.png'), full_page=True)
        with page.expect_download() as downloaded_txt:
            page.locator('#saveText').click()
        txt = downloaded_txt.value
        assert txt.suggested_filename == 'DPRO_CAR02_R91_COMPANY_PC_TRIAGE.txt'
        text_path = screenshots / f'{name}_synthetic_r91.txt'
        txt.save_as(str(text_path))
        report = text_path.read_text(encoding='utf-8')
        assert '要修正：1件 / 未確認：6件 / 問題なし：1件' in report
        assert 'NO_GO' in report and 'HOLD' in report
        assert '本番DB変更' in report
        # Refuse untrusted evidence and retain the valid, previously imported summary.
        page.locator('#sourceFile').set_input_files({'name': 'forged.json', 'mimeType': 'application/json',
                                                    'buffer': b'{"productionReady":true}'})
        expect(page.locator('#message')).to_contain_text('このファイルは読み込めません')
        expect(page.locator('#issueCount')).to_have_text('1')
        page.locator('#sourceFile').set_input_files({'name': 'oversized.json', 'mimeType': 'application/json',
                                                    'buffer': b'X' * 16385})
        expect(page.locator('#message')).to_contain_text('16KB以下')
        expect(page.locator('#issueCount')).to_have_text('1')
        print('R114_INVALID_IMPORT_REJECTED_PASS', name)
        page.locator('#reset').click()
        expect(page.locator('#issueCount')).to_have_text('0')
        expect(page.locator('#pendingCount')).to_have_text('8')
        assert not errors, 'R114_BROWSER_JS_ERRORS ' + json.dumps(errors, ensure_ascii=False)
        assert not forbidden, 'R114_EXTERNAL_REQUESTS ' + json.dumps(forbidden, ensure_ascii=False)
        print(f'R114_{name.upper()}_ROUNDTRIP_PASS width={width} no_overflow=true external_requests=0')
    except BaseException:
        page.screenshot(path=str(screenshots / f'{name}_failure.png'), full_page=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='r114-browser-evidence')
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), SafeFixture)
    thread = Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        origin = f'http://127.0.0.1:{srv.server_port}'
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            try:
                exercise(browser, 'desktop', 1280, 840, origin, out)
                exercise(browser, 'mobile', 375, 800, origin, out)
            finally:
                browser.close()
        print('R114_NO_EXTERNAL_REQUESTS_PASS')
        print('R114_R90_R91_REAL_HTTP_MODULE_ROUNDTRIP_PASS')
    finally:
        srv.shutdown()
        srv.server_close()

if __name__ == '__main__':
    main()
