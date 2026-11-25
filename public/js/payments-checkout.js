(function initPaymentCheckoutFlow() {
  const typeSelect = document.querySelector('[data-intention-type-select]');
  const amountDisplay = document.getElementById('intention-amount-display');
  const objetInput = document.getElementById('objet');

  function syncIntentionTariff() {
    if (!(typeSelect instanceof HTMLSelectElement)) return;
    const opt = typeSelect.options[typeSelect.selectedIndex];
    if (!opt) return;
    const amount = Number(opt.getAttribute('data-amount') || 2000);
    const label = opt.getAttribute('data-label') || '';
    if (amountDisplay instanceof HTMLInputElement) {
      amountDisplay.value = `${amount.toLocaleString('fr-FR')} XOF`;
    }
    if (objetInput instanceof HTMLInputElement && !objetInput.dataset.userEdited) {
      objetInput.value = label;
    }
  }

  if (objetInput instanceof HTMLInputElement) {
    objetInput.addEventListener('input', () => {
      objetInput.dataset.userEdited = objetInput.value.trim() ? '1' : '';
    });
  }

  if (typeSelect instanceof HTMLSelectElement) {
    typeSelect.addEventListener('change', syncIntentionTariff);
    syncIntentionTariff();
  }

  const checkoutForm = document.getElementById('mobile-money-checkout-form');
  if (!(checkoutForm instanceof HTMLFormElement)) return;

  const stepProviders = document.getElementById('payment-step-providers');
  const stepForm = document.getElementById('payment-step-form');
  const processingPanel = document.getElementById('payment-processing-panel');
  const successPanel = document.getElementById('payment-success-panel');
  const failurePanel = document.getElementById('payment-failure-panel');
  const feedbackBox = document.getElementById('checkout-feedback');

  const providerInput = document.getElementById('checkout-provider-input');
  const providerTitle = document.getElementById('selected-provider-title');
  const providerUssd = document.getElementById('selected-provider-ussd');
  const phoneHint = document.getElementById('checkout-phone-hint');
  const phoneInput = document.getElementById('checkout-phone');
  const amountInput = document.getElementById('checkout-amount');
  const scenarioSelect = document.getElementById('checkout-scenario');
  const confirmBtn = document.getElementById('confirm-payment-btn');
  const changeProviderBtn = document.getElementById('change-provider-btn');
  const retryBtn = document.getElementById('retry-payment-btn');
  const retryScenarioSelect = document.getElementById('retry-scenario-select');

  function csrfToken() {
    return window.missaUI?.getCsrfToken?.() || '';
  }

  function showError(message) {
    if (!feedbackBox) return;
    feedbackBox.textContent = message;
    feedbackBox.className = 'alert alert-error mb-4';
    feedbackBox.classList.remove('hidden');
  }

  function clearError() {
    if (!feedbackBox) return;
    feedbackBox.classList.add('hidden');
  }

  function selectProvider(card) {
    const code = card.getAttribute('data-select-provider') || '';
    const name = card.getAttribute('data-provider-name') || code;
    const hint = card.getAttribute('data-provider-hint') || '';
    const ussd = card.getAttribute('data-provider-ussd') || '';

    document.querySelectorAll('[data-select-provider]').forEach((el) => {
      const active = el === card;
      el.classList.toggle('is-selected', active);
      el.setAttribute('aria-pressed', String(active));
    });

    if (providerInput instanceof HTMLInputElement) providerInput.value = code;
    if (providerTitle) providerTitle.textContent = name;
    if (providerUssd) providerUssd.textContent = ussd;
    if (phoneHint) phoneHint.textContent = `Format attendu : ${hint} (aucun code PIN requis).`;

    if (stepForm) stepForm.classList.remove('hidden');
    if (failurePanel) failurePanel.classList.add('hidden');
    clearError();
  }

  document.querySelectorAll('[data-select-provider]').forEach((card) => {
    card.addEventListener('click', () => selectProvider(card));
  });

  if (changeProviderBtn) {
    changeProviderBtn.addEventListener('click', () => {
      if (stepProviders) stepProviders.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runSimulatedProcessingAnimation() {
    if (stepProviders) stepProviders.classList.add('hidden');
    if (stepForm) stepForm.classList.add('hidden');
    if (failurePanel) failurePanel.classList.add('hidden');
    if (successPanel) successPanel.classList.add('hidden');
    if (processingPanel) processingPanel.classList.remove('hidden');

    const stepItems = Array.from(document.querySelectorAll('#payment-processing-steps [data-step]'));
    stepItems.forEach((el) => {
      el.classList.remove('is-active', 'is-done');
    });

    for (let i = 0; i < stepItems.length; i += 1) {
      stepItems[i].classList.add('is-active');
      await wait(240);
      stepItems[i].classList.remove('is-active');
      stepItems[i].classList.add('is-done');
    }
  }

  function providerDisplayName(code) {
    const names = {
      WAVE: 'Wave',
      ORANGE_MONEY: 'Orange Money',
      MTN_MONEY: 'MTN Mobile Money',
      MOOV_MONEY: 'Moov Money',
    };
    return names[code] || code;
  }

  function statusDisplayLabel(status) {
    const labels = {
      SUCCESS: 'Réussi',
      FAILED: 'Échoué',
      CANCELLED: 'Annulé',
      PENDING: 'En attente',
      EXPIRED: 'Expiré',
    };
    return labels[status] || status;
  }

  function renderPaymentOutcome(data) {
    if (processingPanel) processingPanel.classList.add('hidden');
    const payment = data.payment;
    if (!payment) return;

    checkoutForm.dataset.existingPaymentId = payment.id;
    checkoutForm.dataset.existingPaymentStatus = payment.status;

    if (payment.status === 'SUCCESS') {
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setTxt('receipt-amount', `${Number(payment.amount).toLocaleString('fr-FR')} ${payment.currency}`);
      setTxt('receipt-provider', providerDisplayName(payment.provider));
      setTxt('receipt-phone', payment.faithfulPhone);
      setTxt('receipt-txn-ref', payment.transactionReference);
      setTxt('receipt-intention-ref', payment.intentionTrackingRef);
      setTxt('receipt-date', new Date(payment.confirmedAt || payment.createdAt).toLocaleString('fr-FR'));
      setTxt('receipt-parish', payment.parishName);

      const trackingLink = document.getElementById('receipt-tracking-link');
      if (trackingLink instanceof HTMLAnchorElement) {
        trackingLink.href = `/demande-intention?ref=${encodeURIComponent(payment.intentionTrackingRef)}`;
      }
      if (successPanel) successPanel.classList.remove('hidden');
      return;
    }

    const titleEl = document.getElementById('failure-panel-title');
    const msgEl = document.getElementById('failure-panel-message');
    const statusEl = document.getElementById('failure-status-label');
    const txnEl = document.getElementById('failure-txn-ref');
    const intEl = document.getElementById('failure-intention-ref');
    const provEl = document.getElementById('failure-provider');

    if (titleEl) {
      titleEl.textContent =
        payment.status === 'PENDING'
          ? 'Paiement simulé en attente'
          : payment.status === 'CANCELLED'
            ? 'Paiement simulé annulé'
            : 'Paiement simulé refusé';
    }
    if (msgEl) msgEl.textContent = data.operatorMessage || payment.failureReason || 'Transaction non aboutie.';
    if (statusEl) statusEl.textContent = statusDisplayLabel(payment.status);
    if (txnEl) txnEl.textContent = payment.transactionReference;
    if (intEl) intEl.textContent = payment.intentionTrackingRef;
    if (provEl) provEl.textContent = providerDisplayName(payment.provider);
    if (retryBtn instanceof HTMLButtonElement) {
      retryBtn.setAttribute('data-retry-payment-id', payment.id);
    }
    if (failurePanel) failurePanel.classList.remove('hidden');
  }

  async function submitCheckout(url, payload) {
    clearError();
    if (confirmBtn instanceof HTMLButtonElement) confirmBtn.disabled = true;
    if (retryBtn instanceof HTMLButtonElement) retryBtn.disabled = true;

    try {
      const [response] = await Promise.all([
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': csrfToken(),
          },
          body: JSON.stringify(payload),
        }),
        runSimulatedProcessingAnimation(),
      ]);

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        if (processingPanel) processingPanel.classList.add('hidden');
        if (stepProviders) stepProviders.classList.remove('hidden');
        if (stepForm) stepForm.classList.remove('hidden');
        showError(data.error || 'Impossible d’exécuter le paiement simulé.');
        return;
      }

      renderPaymentOutcome(data);
    } catch (error) {
      if (processingPanel) processingPanel.classList.add('hidden');
      if (stepProviders) stepProviders.classList.remove('hidden');
      if (stepForm) stepForm.classList.remove('hidden');
      showError(error instanceof Error ? error.message : 'Erreur réseau.');
    } finally {
      if (confirmBtn instanceof HTMLButtonElement) confirmBtn.disabled = false;
      if (retryBtn instanceof HTMLButtonElement) retryBtn.disabled = false;
    }
  }

  checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const provider = providerInput instanceof HTMLInputElement ? providerInput.value : '';
    if (!provider) {
      showError('Veuillez sélectionner un opérateur Mobile Money.');
      return;
    }
    const existingId = checkoutForm.dataset.existingPaymentId || '';
    const existingStatus = checkoutForm.dataset.existingPaymentStatus || '';
    const faithfulPhone = phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '';
    const amount = amountInput instanceof HTMLInputElement ? Number(amountInput.value) : 2000;
    const scenario = scenarioSelect instanceof HTMLSelectElement ? scenarioSelect.value : 'SUCCESS';

    if (existingId && ['FAILED', 'CANCELLED', 'EXPIRED', 'PENDING'].includes(existingStatus)) {
      await submitCheckout(`/api/payments/${encodeURIComponent(existingId)}/retry`, {
        provider,
        faithfulPhone,
        scenario,
      });
      return;
    }

    await submitCheckout('/api/payments/simulate', {
      intentionId: checkoutForm.dataset.intentionId,
      intentionTrackingRef: checkoutForm.dataset.intentionRef,
      provider,
      faithfulPhone,
      amount,
      scenario,
    });
  });

  if (retryBtn instanceof HTMLButtonElement) {
    retryBtn.addEventListener('click', async () => {
      const paymentId = retryBtn.getAttribute('data-retry-payment-id') || checkoutForm.dataset.existingPaymentId || '';
      if (!paymentId) return;
      const provider = providerInput instanceof HTMLInputElement && providerInput.value
        ? providerInput.value
        : undefined;
      const faithfulPhone = phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : undefined;
      const scenario = retryScenarioSelect instanceof HTMLSelectElement ? retryScenarioSelect.value : 'SUCCESS';

      await submitCheckout(`/api/payments/${encodeURIComponent(paymentId)}/retry`, {
        provider,
        faithfulPhone,
        scenario,
      });
    });
  }
})();
