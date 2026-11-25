(function initPaymentsDashboard() {
  const PROVIDER_LABELS = {
    WAVE: 'Wave',
    ORANGE_MONEY: 'Orange Money',
    MTN_MONEY: 'MTN Mobile Money',
    MOOV_MONEY: 'Moov Money',
  };

  const STATUS_LABELS = {
    PENDING: 'En attente',
    SUCCESS: 'Réussi',
    FAILED: 'Échoué',
    CANCELLED: 'Annulé',
    EXPIRED: 'Expiré',
  };

  const STATUS_BADGE_CLASS = {
    PENDING: 'badge-warning',
    SUCCESS: 'badge-success',
    FAILED: 'badge-danger',
    CANCELLED: 'badge-neutral',
    EXPIRED: 'badge-neutral',
  };

  const INTENTION_LABELS = {
    PENDING: 'En attente',
    PROCESSING: 'En traitement',
    ACCEPTED: 'Acceptée',
    SCHEDULED: 'Programmée',
    CELEBRATED: 'Célébrée',
    REJECTED: 'Refusée',
    CANCELLED: 'Annulée',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function apiBaseForScope(scope) {
    return scope === 'super_admin' ? '/api/super-admin/payments' : '/api/payments';
  }

  function buildQueryFromForm(form, page) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const clean = String(v || '').trim();
      if (clean) params.set(k, clean);
    }
    params.set('page', String(page || 1));
    params.set('limit', '10');
    return params;
  }

  function renderProviderPillHtml(code) {
    const shortMap = {
      WAVE: ['provider-badge-wave', 'W'],
      ORANGE_MONEY: ['provider-badge-orange', 'OM'],
      MTN_MONEY: ['provider-badge-mtn', 'MTN'],
      MOOV_MONEY: ['provider-badge-moov', 'MOOV'],
    };
    const [cls, short] = shortMap[code] || ['provider-badge-wave', code];
    return `<span class="provider-pill ${cls}"><span class="provider-emblem" aria-hidden="true">${escapeHtml(short)}</span><span>${escapeHtml(PROVIDER_LABELS[code] || code)}</span></span>`;
  }

  function renderTableHtml(scope, data) {
    const items = Array.isArray(data.items) ? data.items : [];
    const rowsHtml =
      items.length > 0
        ? items
            .map((tx) => {
              const badgeCls = STATUS_BADGE_CLASS[tx.status] || 'badge-neutral';
              const badgeLbl = STATUS_LABELS[tx.status] || tx.status;
              const parishSub =
                scope === 'super_admin'
                  ? `<span class="table-cell-sub">${escapeHtml(tx.parishName)}</span>`
                  : '';
              return `
                <tr>
                  <td>
                    <code>${escapeHtml(tx.transactionReference)}</code>
                    <span class="table-cell-sub">Simulée · #${escapeHtml(tx.attemptNumber)}</span>
                  </td>
                  <td>
                    <span class="table-cell-title">${escapeHtml(tx.faithfulName)}</span>
                    ${parishSub}
                  </td>
                  <td>${escapeHtml(tx.faithfulPhone)}</td>
                  <td><code>${escapeHtml(tx.intentionTrackingRef)}</code></td>
                  <td>${renderProviderPillHtml(tx.provider)}</td>
                  <td><strong>${Number(tx.amount).toLocaleString('fr-FR')} ${escapeHtml(tx.currency)}</strong></td>
                  <td>${escapeHtml(new Date(tx.createdAt).toLocaleString('fr-FR'))}</td>
                  <td><span class="badge ${badgeCls}">${escapeHtml(badgeLbl)}</span></td>
                  <td>
                    <button type="button" class="btn btn-outline btn-sm" data-open-payment-detail="${escapeHtml(tx.id)}" data-payment-scope="${escapeHtml(scope)}">
                      <span class="material-symbols-rounded icon-sm" aria-hidden="true">visibility</span>
                      <span>Détails</span>
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('')
        : '<tr><td colspan="9" class="empty-state">Aucune transaction Mobile Money simulée enregistrée pour ces critères.</td></tr>';

    const prevDisabled = data.page <= 1 ? 'disabled' : '';
    const nextDisabled = data.page >= data.totalPages ? 'disabled' : '';

    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Référence</th>
              <th>Fidèle</th>
              <th>Téléphone</th>
              <th>Intention</th>
              <th>Opérateur</th>
              <th>Montant</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="${escapeHtml(scope)}-payments-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div id="${escapeHtml(scope)}-payments-pagination" class="payment-pagination">
        <span class="text-muted">Page ${escapeHtml(data.page)} / ${escapeHtml(data.totalPages)} · ${escapeHtml(data.total)} transaction(s)</span>
        <div class="table-actions">
          <button type="button" class="btn btn-outline btn-sm" data-payments-page="${Math.max(1, data.page - 1)}" data-payments-scope="${escapeHtml(scope)}" ${prevDisabled}>Précédent</button>
          <button type="button" class="btn btn-outline btn-sm" data-payments-page="${Math.min(data.totalPages, data.page + 1)}" data-payments-scope="${escapeHtml(scope)}" ${nextDisabled}>Suivant</button>
        </div>
      </div>
    `;
  }

  async function refreshPaymentsTable(scope, page) {
    const form = document.querySelector(`[data-payments-filter-form="${scope}"]`);
    const container = document.getElementById(`${scope}-payments-table-container`);
    if (!(form instanceof HTMLFormElement) || !container) return;

    const params = buildQueryFromForm(form, page);
    container.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${apiBaseForScope(scope)}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Erreur lors du chargement des paiements.');
      }
      container.innerHTML = renderTableHtml(scope, data);
    } catch (err) {
      const fb = document.getElementById('parish-payments-feedback') || document.getElementById('super-admin-feedback');
      if (fb) {
        fb.textContent = err instanceof Error ? err.message : 'Erreur chargement.';
        fb.className = 'alert alert-error mb-4';
        fb.classList.remove('hidden');
      }
    } finally {
      container.removeAttribute('aria-busy');
    }
  }

  async function openPaymentDetailModal(paymentId, scope) {
    const modal = document.getElementById('payment-details-modal');
    if (!modal) return;

    try {
      const response = await fetch(`${apiBaseForScope(scope)}/${encodeURIComponent(paymentId)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Impossible de charger les détails.');
      }

      const p = data.payment;
      const intention = data.intention || {};
      const parish = data.parish || {};
      const events = Array.isArray(data.events) ? data.events : [];

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setTxt('pd-ref', p.transactionReference);
      setTxt('pd-provider', PROVIDER_LABELS[p.provider] || p.provider);
      setTxt('pd-amount', `${Number(p.amount).toLocaleString('fr-FR')} ${p.currency}`);
      setTxt('pd-status', STATUS_LABELS[p.status] || p.status);
      setTxt('pd-created', new Date(p.createdAt).toLocaleString('fr-FR'));
      setTxt('pd-confirmed', p.confirmedAt ? new Date(p.confirmedAt).toLocaleString('fr-FR') : 'Non confirmée');
      setTxt('pd-attempt', `#${p.attemptNumber}`);
      setTxt('pd-faithful-name', p.faithfulName);
      setTxt('pd-faithful-phone', p.faithfulPhone);
      setTxt('pd-parish', parish.name || p.parishName);
      setTxt('pd-intention-ref', p.intentionTrackingRef);
      setTxt('pd-intention-objet', intention.objet || '-');
      setTxt('pd-intention-status', INTENTION_LABELS[intention.status] || intention.status || '-');

      const failureBox = document.getElementById('pd-failure-box');
      if (failureBox) {
        if (p.failureReason) {
          failureBox.textContent = p.failureReason;
          failureBox.classList.remove('hidden');
        } else {
          failureBox.classList.add('hidden');
        }
      }

      const eventsList = document.getElementById('pd-events-list');
      if (eventsList) {
        eventsList.innerHTML =
          events.length > 0
            ? events
                .map(
                  (evt) => `
                  <li class="payment-event-item">
                    <div class="payment-event-meta">
                      <strong>${escapeHtml(evt.eventType)} (${escapeHtml(STATUS_LABELS[evt.newStatus] || evt.newStatus)})</strong>
                      <span>${escapeHtml(new Date(evt.createdAt).toLocaleString('fr-FR'))}</span>
                    </div>
                    <p>${escapeHtml(evt.description)}</p>
                  </li>
                `
                )
                .join('')
            : '<li class="payment-event-item">Aucun événement enregistré.</li>';
      }

      modal.classList.remove('hidden');
    } catch (err) {
      const fb = document.getElementById('parish-payments-feedback') || document.getElementById('super-admin-feedback');
      if (fb) {
        fb.textContent = err instanceof Error ? err.message : 'Erreur détails transaction.';
        fb.className = 'alert alert-error mb-4';
        fb.classList.remove('hidden');
      }
    }
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const scope = form.getAttribute('data-payments-filter-form');
    if (!scope) return;
    event.preventDefault();
    void refreshPaymentsTable(scope, 1);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const resetBtn = target.closest('[data-payments-reset]');
    if (resetBtn) {
      const scope = resetBtn.getAttribute('data-payments-reset');
      const form = document.querySelector(`[data-payments-filter-form="${scope}"]`);
      if (form instanceof HTMLFormElement) {
        form.reset();
        void refreshPaymentsTable(scope, 1);
      }
      return;
    }

    const pageBtn = target.closest('[data-payments-page]');
    if (pageBtn instanceof HTMLButtonElement && !pageBtn.disabled) {
      const page = Number(pageBtn.getAttribute('data-payments-page') || 1);
      const scope = pageBtn.getAttribute('data-payments-scope') || 'parish';
      void refreshPaymentsTable(scope, page);
      return;
    }

    const detailBtn = target.closest('[data-open-payment-detail]');
    if (detailBtn) {
      const paymentId = detailBtn.getAttribute('data-open-payment-detail');
      const scope = detailBtn.getAttribute('data-payment-scope') || 'parish';
      if (paymentId) {
        void openPaymentDetailModal(paymentId, scope);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const modal = document.getElementById('payment-details-modal');
      if (modal) modal.classList.add('hidden');
    }
  });
})();
