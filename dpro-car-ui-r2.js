/* DPRO CAR UI Quality Layer R2 + R5 / 2026-10-09
 * Deliberately leaves all existing handlers, forms, networking, storage,
 * authorization and shop identity unchanged. Safe as a no-op on unknown pages.
 */
(() => {
  'use strict';
  const name = location.pathname.split('/').pop() || 'index.html';
  const pages = {
    'dashboard.html':'dashboard',
    'owner-ipad.html':'ipad',
    'member.html':'member',
    'index-product-demo.html':'consult',
  };
  const page = pages[name];
  if (!page) return;
  const root = document.documentElement;
  if (root.dataset.dproCarUi === 'r2') return;
  root.dataset.dproCarUi = 'r2';
  root.dataset.carPage = page;
  function init() {
    const main = document.querySelector('main');
    if (main && !document.querySelector('.dpro-car-skip')) {
      if (!main.id) main.id='dpro-car-main';
      const skip = document.createElement('a');
      skip.className = 'dpro-car-skip';
      skip.href = '#' + main.id;
      skip.textContent = '本文へ移動';
      document.body.insertBefore(skip,document.body.firstChild);
    }
    // Mark current nav for assistive technology without touching click handlers.
    function updateNav() {
      const menu = page==='dashboard' ? document.querySelectorAll('.sidebar .nav button')
        : page==='ipad' ? document.querySelectorAll('.header .tabs .tab-btn') : [];
      menu.forEach(button => {
        if (button.classList.contains('active')) button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
    }
    updateNav();
    if (page==='dashboard' || page==='ipad') {
      const nav = document.querySelector(page==='dashboard' ? '.sidebar .nav' : '.header .tabs');
      if (nav) {
        const observer=new MutationObserver(updateNav);
        observer.observe(nav,{attributes:true,subtree:true,attributeFilter:['class']});
      }
    }
  }
  // R5: consultation sample has NO registered customer/vehicle fixture.
  // Fix the indefinitely visible 'checking' message using the application's
  // own local, non-network state helpers. Never run on authenticated screens.
  function initSafeConsultDemo() {
    if (page !== 'consult') return;
    const banner = document.getElementById('embed-demo-banner');
    if (!banner || !banner.textContent.includes('製品紹介用デモ')) return;
    if (document.documentElement.dataset.carDemoInit === 'r5') return;
    // The product-demo source sets IS_EMBED_DEMO=true and does not query profiles.
    // Deferring once allows its onload callback to populate the demo identity.
    setTimeout(() => {
      if (typeof renderNoRegisteredCustomer !== 'function' || typeof setCustomerMode !== 'function') return;
      renderNoRegisteredCustomer();
      setCustomerMode('initial', '初回相談の表示例',
        'このデモでは顧客・車両の登録照会を行いません。お車を入力して画面を試せます。送信しても記録されません。');
      const help = document.getElementById('lineAccountHelp');
      if (help) help.textContent = 'デモ用アカウントです。実際の顧客情報は取得しません。';
      const choice = document.getElementById('vehicleQuickChoice');
      if (choice) { choice.classList.add('dpro-car-demo-hide'); choice.setAttribute('aria-hidden','true'); }
      const registered = document.getElementById('quickRegisteredBtn');
      if (registered) registered.disabled = true;
      const newButton = document.getElementById('quickNewVehicleBtn');
      if (newButton) newButton.setAttribute('aria-pressed','true');
      const status = document.getElementById('customerModeBox');
      if (status) status.setAttribute('aria-live','polite');
      document.documentElement.dataset.carDemoInit = 'r5';
    }, 0);
  }
  if (page === 'consult') {
    if (document.readyState === 'complete') initSafeConsultDemo();
    else window.addEventListener('load', initSafeConsultDemo, {once:true});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
