function closeMobileDrawer(restoreFocus = false) {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.querySelector('[data-drawer-toggle]');
  const wasOpen = Boolean(sidebar && sidebar.classList.contains('is-open'));
  if (sidebar) sidebar.classList.remove('is-open');
  if (backdrop) backdrop.classList.remove('is-open');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && wasOpen && toggle instanceof HTMLElement) {
      toggle.focus();
    }
  }
}

function normalizeFilterText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function applyTableFilters(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const searchInput = document.querySelector(`[data-table-search="${tbodyId}"]`);
  const filterSelect = document.querySelector(`[data-table-filter="${tbodyId}"]`);
  const emptyNotice = document.getElementById(`${tbodyId}-empty`);

  const searchTerm = normalizeFilterText(searchInput ? searchInput.value : '');
  const statusTerm = normalizeFilterText(filterSelect ? filterSelect.value : '');

  const rows = Array.from(tbody.querySelectorAll('tr'));
  let dataRowCount = 0;
  let visibleCount = 0;

  rows.forEach((row) => {
    if (row.querySelector('.empty-state')) return;
    dataRowCount += 1;

    const rowText = normalizeFilterText(row.textContent);
    const badgeEl = row.querySelector('.badge');
    const rowStatus = normalizeFilterText(badgeEl ? badgeEl.textContent : '');

    const matchesSearch = !searchTerm || rowText.includes(searchTerm);
    const matchesStatus = !statusTerm || rowStatus === statusTerm || rowStatus.includes(statusTerm);
    const isVisible = matchesSearch && matchesStatus;

    row.classList.toggle('hidden', !isVisible);
    if (isVisible) visibleCount += 1;
  });

  if (emptyNotice) {
    const showEmpty = dataRowCount > 0 && visibleCount === 0;
    emptyNotice.classList.toggle('hidden', !showEmpty);
  }
}

function applyCardsFilters(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  const searchInput = document.querySelector(`[data-cards-search="${gridId}"]`);
  const filterSelect = document.querySelector(`[data-cards-filter="${gridId}"]`);
  const emptyNotice = document.getElementById(`${gridId}-empty`);

  const searchTerm = normalizeFilterText(searchInput ? searchInput.value : '');
  const typeTerm = normalizeFilterText(filterSelect ? filterSelect.value : '');

  const cards = Array.from(grid.querySelectorAll('.annonce-card'));
  let visibleCount = 0;

  cards.forEach((card) => {
    const cardText = normalizeFilterText(card.textContent);
    const cardType = normalizeFilterText(card.getAttribute('data-filter-type'));

    const matchesSearch = !searchTerm || cardText.includes(searchTerm);
    const matchesType = !typeTerm || cardType === typeTerm;
    const isVisible = matchesSearch && matchesType;

    card.classList.toggle('hidden', !isVisible);
    if (isVisible) visibleCount += 1;
  });

  if (emptyNotice) {
    const showEmpty = cards.length > 0 && visibleCount === 0;
    emptyNotice.classList.toggle('hidden', !showEmpty);
  }
}

function applyAllFilters() {
  document.querySelectorAll('[data-table-search]').forEach((el) => {
    const id = el.getAttribute('data-table-search');
    if (id) applyTableFilters(id);
  });
  document.querySelectorAll('[data-cards-search]').forEach((el) => {
    const id = el.getAttribute('data-cards-search');
    if (id) applyCardsFilters(id);
  });
}

window.missaUI = {
  applyFilters: applyAllFilters,
};

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const toggleBtn = target.closest('[data-toggle-password]');
  if (toggleBtn) {
    const inputId = toggleBtn.getAttribute('data-toggle-password');
    const input = inputId ? document.getElementById(inputId) : null;
    if (input && input instanceof HTMLInputElement) {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      toggleBtn.textContent = isPassword ? 'Masquer' : 'Afficher';
      toggleBtn.setAttribute('aria-pressed', String(isPassword));
    }
    return;
  }

  const drawerToggle = target.closest('[data-drawer-toggle]');
  if (drawerToggle) {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar && backdrop) {
      const willOpen = !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', willOpen);
      backdrop.classList.toggle('is-open', willOpen);
      drawerToggle.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        const firstNav = sidebar.querySelector('.nav-link');
        if (firstNav instanceof HTMLElement) firstNav.focus();
      }
    }
    return;
  }

  if (target.id === 'sidebar-backdrop') {
    closeMobileDrawer(true);
    return;
  }

  if (target.id === 'settings-btn') {
    const feedback = document.getElementById('sidebar-feedback');
    if (feedback) {
      feedback.textContent = 'Paramètres paroisse : utilisez votre compte Google Firebase pour gérer la synchronisation.';
      feedback.classList.remove('hidden');
    }
    return;
  }

  if (target.closest('#notification-btn') || target.closest('[data-goto-intentions]')) {
    const intentionsLink = document.getElementById('reload-btn1');
    if (intentionsLink) intentionsLink.click();
    return;
  }

  if (target.closest('[data-close-edit-form]')) {
    const editForm = document.getElementById('intention-edit-form');
    if (editForm) editForm.classList.add('hidden');
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const tableId = target.getAttribute('data-table-search');
  if (tableId) {
    applyTableFilters(tableId);
    return;
  }

  const gridId = target.getAttribute('data-cards-search');
  if (gridId) {
    applyCardsFilters(gridId);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const tableId = target.getAttribute('data-table-filter');
  if (tableId) {
    applyTableFilters(tableId);
    return;
  }

  const gridId = target.getAttribute('data-cards-filter');
  if (gridId) {
    applyCardsFilters(gridId);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMobileDrawer(true);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.hasAttribute('data-validate-passwords')) {
    const pw = form.querySelector('#motdepasse');
    const confirmPw = form.querySelector('#confirmationmotdepasse');
    const errEl = document.getElementById('password-match-error');

    if (
      pw instanceof HTMLInputElement &&
      confirmPw instanceof HTMLInputElement &&
      pw.value !== confirmPw.value
    ) {
      event.preventDefault();
      if (errEl) errEl.classList.remove('hidden');
      confirmPw.classList.add('is-invalid');
      confirmPw.focus();
      return;
    }

    if (errEl) errEl.classList.add('hidden');
    if (confirmPw instanceof HTMLInputElement) {
      confirmPw.classList.remove('is-invalid');
    }
  }

  if (form.hasAttribute('data-loading-form')) {
    if (event.defaultPrevented) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Chargement...';
    }
  }
});
