(function initSuperAdminActions() {
  function csrfToken() {
    return window.missaUI?.getCsrfToken?.() || '';
  }

  function showFeedback(message, isError) {
    const box = document.getElementById('super-admin-feedback');
    if (!box) return;
    box.textContent = message;
    box.className = isError ? 'alert alert-error mb-4' : 'alert alert-success mb-4';
    box.classList.remove('hidden');
  }

  function revealCredentials(parishName, data) {
    const box = document.getElementById('sa-credential-reveal');
    const parishEl = document.getElementById('reveal-parish');
    const passEl = document.getElementById('reveal-password');
    const linkEl = document.getElementById('reveal-link');
    const expEl = document.getElementById('reveal-expires');
    if (!box || !passEl || !linkEl || !expEl) return;
    if (parishEl) parishEl.textContent = parishName || 'Paroisse attribuée';
    passEl.textContent = data.temporaryPassword || '';
    linkEl.textContent = data.activationLink || '';
    expEl.textContent = data.expiresAt ? new Date(data.expiresAt).toLocaleString('fr-FR') : '';
    box.classList.remove('hidden');
  }

  async function apiJson(url, method, payload) {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-csrf-token': csrfToken(),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Opération refusée.');
    }
    return data;
  }

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const parishStatusBtn = target.closest('[data-sa-parish-status]');
    if (parishStatusBtn instanceof HTMLButtonElement) {
      const status = parishStatusBtn.getAttribute('data-sa-parish-status');
      const parishId = parishStatusBtn.getAttribute('data-parish-id');
      if (!status || !parishId) return;
      parishStatusBtn.disabled = true;
      try {
        await apiJson(`/api/super-admin/parishes/${encodeURIComponent(parishId)}/status`, 'PATCH', {
          status,
        });
        window.location.reload();
      } catch (error) {
        parishStatusBtn.disabled = false;
        showFeedback(error instanceof Error ? error.message : 'Erreur statut paroisse.', true);
      }
      return;
    }

    const adminStatusBtn = target.closest('[data-sa-admin-status]');
    if (adminStatusBtn instanceof HTMLButtonElement) {
      const status = adminStatusBtn.getAttribute('data-sa-admin-status');
      const userId = adminStatusBtn.getAttribute('data-user-id');
      if (!status || !userId) return;
      adminStatusBtn.disabled = true;
      try {
        await apiJson(`/api/super-admin/admins/${encodeURIComponent(userId)}/status`, 'PATCH', {
          status,
        });
        window.location.reload();
      } catch (error) {
        adminStatusBtn.disabled = false;
        showFeedback(error instanceof Error ? error.message : 'Erreur statut compte.', true);
      }
      return;
    }

    const resetBtn = target.closest('[data-sa-reset-admin]');
    if (resetBtn instanceof HTMLButtonElement) {
      const userId = resetBtn.getAttribute('data-sa-reset-admin');
      if (!userId) return;
      resetBtn.disabled = true;
      try {
        const data = await apiJson(
          `/api/super-admin/admins/${encodeURIComponent(userId)}/reset-access`,
          'POST'
        );
        revealCredentials('Réinitialisation administrateur', data);
        showFeedback('Nouveau mot de passe temporaire généré avec succès.', false);
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur réinitialisation.', true);
      } finally {
        resetBtn.disabled = false;
      }
      return;
    }

    const reqBtn = target.closest('[data-sa-review-request]');
    if (reqBtn instanceof HTMLButtonElement) {
      const decision = reqBtn.getAttribute('data-sa-review-request');
      const requestId = reqBtn.getAttribute('data-request-id');
      if (!decision || !requestId) return;
      reqBtn.disabled = true;
      try {
        await apiJson(`/api/super-admin/parish-requests/${encodeURIComponent(requestId)}`, 'PATCH', {
          decision,
        });
        window.location.reload();
      } catch (error) {
        reqBtn.disabled = false;
        showFeedback(error instanceof Error ? error.message : 'Erreur traitement demande.', true);
      }
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === 'sa-create-parish-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const rawParishId = String(formData.get('directoryParishId') || '');
      try {
        await apiJson('/api/super-admin/parishes', 'POST', {
          provinceId: formData.get('provinceId'),
          dioceseId: formData.get('dioceseId'),
          directoryParishId: rawParishId === '__missing__' ? '' : rawParishId,
          customParishName: formData.get('customParishName'),
          location: formData.get('location'),
          status: 'ACTIVE',
        });
        window.location.reload();
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur création paroisse.', true);
      }
      return;
    }

    if (form.id === 'sa-create-admin-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const rawParishId = String(formData.get('directoryParishId') || '');
      try {
        const data = await apiJson('/api/super-admin/admins', 'POST', {
          provinceId: formData.get('provinceId'),
          dioceseId: formData.get('dioceseId'),
          directoryParishId: rawParishId === '__missing__' ? '' : rawParishId,
          customParishName: formData.get('customParishName'),
          displayName: formData.get('displayName'),
          email: formData.get('email'),
          phone: formData.get('phone'),
        });
        revealCredentials(data.parishName, data);
        showFeedback('Administrateur paroissial créé avec succès.', false);
        form.reset();
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur création admin.', true);
      }
      return;
    }

    if (form.id === 'sa-settings-form') {
      event.preventDefault();
      const formData = new FormData(form);
      try {
        await apiJson('/api/super-admin/settings', 'POST', {
          platformName: formData.get('platformName'),
          supportEmail: formData.get('supportEmail'),
          tempPasswordTtlHours: Number(formData.get('tempPasswordTtlHours') || 48),
          allowPublicFideleSignup:
            form.querySelector('[name="allowPublicFideleSignup"]')?.checked || false,
          requireCureAnnouncementApproval:
            form.querySelector('[name="requireCureAnnouncementApproval"]')?.checked || false,
        });
        showFeedback('Paramètres globaux mis à jour.', false);
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur paramètres.', true);
      }
    }
  });
})();
