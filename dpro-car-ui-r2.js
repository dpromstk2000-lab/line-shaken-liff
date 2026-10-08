/* DPRO CAR UI Quality Layer R2 / 2026-10-08
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
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
