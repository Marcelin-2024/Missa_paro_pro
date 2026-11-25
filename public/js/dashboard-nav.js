(function initDashboardNavigation() {
  const mainContent = document.getElementById('main-content');
  const sidebarNav = document.getElementById('sidebar-nav');

  async function loadSection(refreshUrl, sectionKey, triggerEl) {
    if (!refreshUrl || !mainContent) return;

    if (sidebarNav) {
      sidebarNav.querySelectorAll('.nav-link').forEach((btn) => {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      });
    }
    if (triggerEl) {
      triggerEl.classList.add('active');
      triggerEl.setAttribute('aria-current', 'page');
    }

    mainContent.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(refreshUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) {
        throw new Error('Impossible de charger cette section.');
      }
      const html = await response.text();
      mainContent.innerHTML = html;
      window.missaUI?.applyFilters?.();
      if (sectionKey) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('section', sectionKey);
        window.history.replaceState({}, '', nextUrl.toString());
      }
    } catch (error) {
      console.error(error);
    } finally {
      mainContent.removeAttribute('aria-busy');
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      const toggle = document.querySelector('[data-drawer-toggle]');
      if (sidebar) sidebar.classList.remove('is-open');
      if (backdrop) backdrop.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
  }

  window.missaDashboardNav = {
    reloadActiveSection: async function reloadActiveSection() {
      const active = sidebarNav ? sidebarNav.querySelector('.nav-link.active') : null;
      const url = active ? active.getAttribute('data-refresh-url') : '/refresh/refresh_firt';
      const section = active ? active.getAttribute('data-section') : 'overview';
      await loadSection(url, section, active);
    },
  };

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const navLink = target.closest('#sidebar-nav .nav-link[data-refresh-url]');
    if (navLink) {
      event.preventDefault();
      const refreshUrl = navLink.getAttribute('data-refresh-url');
      const sectionKey = navLink.getAttribute('data-section');
      void loadSection(refreshUrl, sectionKey, navLink);
      return;
    }

    const navTrigger = target.closest('[data-nav-target]');
    if (navTrigger) {
      const sectionKey = navTrigger.getAttribute('data-nav-target');
      const matchingLink = sidebarNav
        ? sidebarNav.querySelector(`.nav-link[data-section="${sectionKey}"]`)
        : null;
      if (matchingLink instanceof HTMLElement) {
        matchingLink.click();
      }
      return;
    }

    if (target.closest('[data-logout-btn]')) {
      window.location.href = '/page/logout';
    }
  });
})();
