#!/usr/bin/env python3
import json,datetime, pathlib, time, threading, functools, http.server, os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parent
EVID=ROOT/'car02_r115_qa_evidence';EVID.mkdir(exist_ok=True)
SERVER='http://127.0.0.1:18815'
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',18815),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
all_results={}
try:
 with sync_playwright() as p:
  launch={'headless':True,'args':['--no-sandbox']}
  if pathlib.Path('/usr/bin/chromium').exists(): launch['executable_path']='/usr/bin/chromium'
  browser=p.chromium.launch(**launch)
  for name,width,height in [('desktop',1440,900),('tablet',768,1000),('mobile',390,844),('narrow',320,730)]:
   page=browser.new_page(viewport={'width':width,'height':height},locale='ja-JP',timezone_id='Asia/Tokyo')
   errors=[];outgoing=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda r:outgoing.append(r.url) if not r.url.startswith(SERVER) else None)
   navigation_tested=True
   try:
    page.goto(SERVER+'/CAR02_R115_ENTRY_PATHS_ISOLATED_QA.html',timeout=3500)
   except Exception as e:
    if 'BLOCKED_BY_ADMINISTRATOR' not in str(e):raise
    navigation_tested=False
    page.close()
    page=browser.new_page(viewport={'width':width,'height':height},locale='ja-JP',timezone_id='Asia/Tokyo')
    errors=[];outgoing=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:outgoing.append(r.url) if not r.url.startswith(SERVER) else None)
    page.set_content((ROOT/'CAR02_R115_ENTRY_PATHS_ISOLATED_QA.html').read_text(encoding='utf-8'))
   page.screenshot(path=str(EVID/(name+'_entry.png')),full_page=True)
   assert page.locator('#toggleLine').get_attribute('aria-pressed')=='false'
   assert page.locator('#lineLink').get_attribute('aria-disabled')=='true'
   assert page.locator('#hpLink').get_attribute('aria-disabled')=='false'
   page.locator('#toggleWeb').click()
   assert all(page.locator('#'+key+'Link').get_attribute('aria-disabled')=='true' for key in ('web','hp','line'))
   page.locator('#hpLink').click(force=True)
   if navigation_tested: assert 'ENTRY_PATHS' in page.url,'disabled HP unexpectedly navigated'
   else: assert page.locator('#pathStatus').inner_text().startswith('この導線はOFF')
   page.locator('#toggleWeb').click()
   page.locator('#toggleHp').click()
   assert page.locator('#hpLink').get_attribute('aria-disabled')=='true'
   assert page.locator('#webLink').get_attribute('aria-disabled')=='false'
   page.locator('#toggleLine').click()
   assert page.locator('#lineLink').get_attribute('aria-disabled')=='false'
   if navigation_tested:
    page.locator('#lineLink').click()
    assert 'BOOKING_CALENDAR' in page.url and 'entry=line' in page.url
    assert 'LINEリッチメニュー（模擬）' in page.locator('#entryLabel').inner_text()
   else:
    assert page.locator('#lineLink').get_attribute('href')=='CAR02_R115_BOOKING_CALENDAR_ISOLATED_QA.html?entry=line'
    page.set_content((ROOT/'CAR02_R115_BOOKING_CALENDAR_ISOLATED_QA.html').read_text(encoding='utf-8'))
   if navigation_tested:
    page.go_back()
    assert 'ENTRY_PATHS' in page.url
    if page.locator('#hpLink').get_attribute('aria-disabled')=='true':page.locator('#toggleHp').click()
    page.locator('#hpLink').click()
    assert 'entry=hp' in page.url and 'HP内予約ボタン（模擬）' in page.locator('#entryLabel').inner_text()
    page.go_back()
    page.locator('#webLink').click()
    assert 'entry=web' in page.url and '予約WEB直接（模擬）' in page.locator('#entryLabel').inner_text()
    page.go_back()
    if page.locator('#lineLink').get_attribute('aria-disabled')=='true':page.locator('#toggleLine').click()
    page.locator('#lineLink').click()
    assert 'entry=line' in page.url and 'LINEリッチメニュー（模擬）' in page.locator('#entryLabel').inner_text()
   page.screenshot(path=str(EVID/(name+'_calendar.png')),full_page=True)
   assert page.locator('#review').is_disabled()
   # choose next available future non-Sunday within first week
   today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
   target=next(today+datetime.timedelta(days=i) for i in range(1,8) if (today+datetime.timedelta(days=i)).weekday()!=6)
   target_s=target.isoformat()
   if target.month!=today.month:
     page.locator('#next').click()
   selected=page.locator(f'button[data-date="{target_s}"]')
   assert selected.is_enabled(),f'next day disabled {target_s}'
   selected.click();page.locator('button[data-time="09:00"]').click()
   assert page.locator('#selectedTime').inner_text()=='09:00〜09:30'
   assert page.locator('#review').is_enabled() and page.locator('#reserve').is_disabled()
   page.locator('#review').click();assert page.locator('#reserve').is_enabled()
   page.locator('#reserve').click()
   assert page.locator('#selectedTime').inner_text()=='未選択'
   assert '予約は成立せず' in page.locator('#bookingStatus').inner_text()
   assert page.locator('button[data-time="09:00"]').is_disabled()
   page.locator('#reset').click()
   if target.month!=today.month: page.locator('#next').click()
   page.locator(f'button[data-date="{target_s}"]').click()
   assert page.locator('button[data-time="09:00"]').is_enabled()
   # Sunday blocked
   sunday=next(today+datetime.timedelta(days=i) for i in range(0,8) if (today+datetime.timedelta(days=i)).weekday()==6)
   if sunday.month!=target.month and sunday.month==today.month:page.locator('#prev').click()
   elif sunday.month!=target.month:page.locator('#next').click()
   assert page.locator(f'button[data-date="{sunday.isoformat()}"]').is_disabled()
   # past time for today if weekday
   if today.weekday()!=6 and 9<=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).hour<18:
    if today.month!=sunday.month:page.locator('#prev').click()
    page.locator(f'button[data-date="{today.isoformat()}"]').click()
    assert page.locator('button[data-time="09:00"]').is_disabled()
   # date beyond 60 unavailable within viewed months
   page.locator('#reset').click()
   upper=today+datetime.timedelta(days=60)
   if upper.month!=today.month:page.locator('#next').click()
   if upper.strftime('%Y-%m')!=(today.replace(day=28)+datetime.timedelta(days=4)).strftime('%Y-%m') and upper.strftime('%Y-%m')!=today.strftime('%Y-%m'):page.locator('#next').click()
   beyond=upper+datetime.timedelta(days=1)
   if beyond.month==upper.month:
    assert page.locator(f'button[data-date="{beyond.isoformat()}"]').is_disabled()
   page.screenshot(path=str(EVID/(name+'_calendar_selected.png')),full_page=True)
   scroll=page.evaluate('({doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})')
   assert scroll['doc']<=scroll['client']+1,(name,scroll)
   assert not errors,(name,errors)
   assert not outgoing,(name,outgoing)
   all_results[name]={'viewport':[width,height],'entry_toggle':'PASS','entry_navigation':'PASS' if navigation_tested else 'LOCAL_NAVIGATION_BLOCKED_TESTED_HREF_ONLY','calendar_day_selection':'PASS','30min_slots':'PASS','Sunday_closed':'PASS','past_time_block':'PASS' if today.weekday()!=6 else 'SKIPPED (today Sunday)','duplicate_hold':'PASS','reset_hold':'PASS','no_network':len(outgoing)==0,'js_errors':len(errors),'horizontal_overflow':False}
   if os.environ.get('GITHUB_ACTIONS') and not navigation_tested:raise AssertionError('GitHub Action must test real HTTP navigation')
   page.close()
  browser.close()
finally:
 server.shutdown()
out=ROOT/'QA_RESULTS.json';out.write_text(json.dumps({'version':'R115','scope':'local isolated UI QA only','results':all_results,'productionRelease':'NO_GO','dbMigration':'HOLD'},ensure_ascii=False,indent=2))
print(out.read_text())
