(function initSuperAdminActions() {
  function csrfToken() {
    return window.missaUI?.getCsrfToken?.() || '';
  }

  function setText(id, value, fallback = '-') {
    const el = document.getElementById(id);
    if (!el) return;
    const str = value !== undefined && value !== null && String(value).trim() !== '' ? String(value) : fallback;
    el.textContent = str;
  }

  function setInputVal(id, value) {
    const el = document.getElementById(id);
    if (el && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      el.value = value !== undefined && value !== null ? String(value) : '';
    }
  }

  function formatDateFr(value, fallback = 'Non renseignée') {
    if (!value) return fallback;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString('fr-FR');
  }

  function showInlineError(boxId, message) {
    const box = document.getElementById(boxId);
    if (!box) return;
    if (!message) {
      box.textContent = '';
      box.classList.add('hidden');
      return;
    }
    box.textContent = message;
    box.classList.remove('hidden');
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

    const parishDetailBtn = target.closest('[data-sa-parish-detail]');
    if (parishDetailBtn instanceof HTMLButtonElement) {
      const id = parishDetailBtn.getAttribute('data-sa-parish-detail');
      if (!id) return;
      try {
        const data = await apiJson(`/api/super-admin/parishes/${encodeURIComponent(id)}`, 'GET');
        const p = data.parish;
        const counts = data.counts || {};
        setText('sapd-subtitle', `${p.provinceName} · ${p.dioceseName}`);
        setText('sapd-name', p.name);
        setText('sapd-province', p.provinceName);
        setText('sapd-diocese', p.dioceseName);
        setText('sapd-location', p.location, 'Non renseignée');
        setText('sapd-address', p.address, 'Non renseignée');
        setText('sapd-phone', p.phone, 'Non renseigné');
        setText('sapd-email', p.email, 'Non renseignée');
        setText('sapd-status', p.status);
        setText('sapd-schedules', p.massScheduleSummary, 'Non renseignés');
        setText(
          'sapd-chapels',
          p.chapelsEnabled && Array.isArray(p.chapels) && p.chapels.length > 0
            ? p.chapels.join(', ')
            : 'Aucune chapelle'
        );
        setText('sapd-staff-count', String(counts.staffCount ?? 0));
        setText('sapd-masses-count', String(counts.massesCount ?? 0));
        setText('sapd-intentions-count', String(counts.intentionsCount ?? 0));
        setText('sapd-created-at', formatDateFr(p.createdAt));
        document.getElementById('sa-parish-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur chargement paroisse.', true);
      }
      return;
    }

    const parishEditBtn = target.closest('[data-sa-parish-edit]');
    if (parishEditBtn instanceof HTMLButtonElement) {
      const id = parishEditBtn.getAttribute('data-sa-parish-edit');
      if (!id) return;
      try {
        const data = await apiJson(`/api/super-admin/parishes/${encodeURIComponent(id)}`, 'GET');
        const p = data.parish;
        showInlineError('sa-parish-edit-error', '');
        setInputVal('sape-id', p.id);
        setInputVal('sape-name', p.name);
        setInputVal('sape-location', p.location || '');
        setInputVal('sape-phone', p.phone || '');
        setInputVal('sape-email', p.email || '');
        setInputVal('sape-address', p.address || '');
        setInputVal('sape-status', p.status || 'ACTIVE');
        setInputVal('sape-schedules', p.massScheduleSummary || '');
        setInputVal('sape-chapels', Array.isArray(p.chapels) ? p.chapels.join(', ') : '');
        const chapCb = document.getElementById('sape-chapelsEnabled');
        if (chapCb instanceof HTMLInputElement) chapCb.checked = Boolean(p.chapelsEnabled);
        document.getElementById('sa-parish-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur chargement paroisse.', true);
      }
      return;
    }

    const adminDetailBtn = target.closest('[data-sa-admin-detail]');
    if (adminDetailBtn instanceof HTMLButtonElement) {
      const userId = adminDetailBtn.getAttribute('data-sa-admin-detail');
      if (!userId) return;
      try {
        const data = await apiJson(`/api/super-admin/admins/${encodeURIComponent(userId)}`, 'GET');
        const u = data.user;
        setText('saad-subtitle', u.email);
        setText('saad-name', u.displayName);
        setText('saad-email', u.email);
        setText('saad-phone', u.phone, 'Non renseigné');
        setText('saad-status', u.status);
        setText('saad-must-change', u.mustChangePassword ? 'Oui (1re connexion)' : 'Non');
        setText('saad-created-at', formatDateFr(u.createdAt));
        setText('saad-last-login', formatDateFr(u.lastLoginAt, 'Jamais connecté'));

        const memList = document.getElementById('saad-memberships-list');
        if (memList) {
          memList.innerHTML = '';
          const items = Array.isArray(data.memberships) ? data.memberships : [];
          if (items.length === 0) {
            const li = document.createElement('li');
            li.className = 'text-muted';
            li.textContent = 'Aucune paroisse rattachée.';
            memList.appendChild(li);
          } else {
            items.forEach((m) => {
              const li = document.createElement('li');
              li.className = 'status-breakdown-item';
              const rolesTxt = (m.roles || []).map((r) => r.label || r.code).join(', ') || 'Aucun rôle';
              li.textContent = `${m.parishName} (${m.membershipStatus}) — ${rolesTxt}`;
              memList.appendChild(li);
            });
          }
        }
        document.getElementById('sa-admin-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur chargement admin.', true);
      }
      return;
    }

    const adminEditBtn = target.closest('[data-sa-admin-edit]');
    if (adminEditBtn instanceof HTMLButtonElement) {
      const userId = adminEditBtn.getAttribute('data-sa-admin-edit');
      if (!userId) return;
      try {
        const data = await apiJson(`/api/super-admin/admins/${encodeURIComponent(userId)}`, 'GET');
        const u = data.user;
        showInlineError('sa-admin-edit-error', '');
        setInputVal('saae-id', u.id);
        setInputVal('saae-displayName', u.displayName);
        setInputVal('saae-phone', u.phone || '');
        document.getElementById('sa-admin-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur chargement admin.', true);
      }
      return;
    }

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
          phone: formData.get('phone'),
          email: formData.get('email'),
          address: formData.get('address'),
          massScheduleSummary: formData.get('massScheduleSummary'),
          status: 'ACTIVE',
        });
        window.location.reload();
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : 'Erreur création paroisse.', true);
      }
      return;
    }

    if (form.id === 'sa-parish-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const id = String(formData.get('id') || '');
      if (!id) return;
      try {
        await apiJson(`/api/super-admin/parishes/${encodeURIComponent(id)}`, 'PATCH', {
          name: formData.get('name'),
          location: formData.get('location'),
          phone: formData.get('phone'),
          email: formData.get('email'),
          address: formData.get('address'),
          status: formData.get('status'),
          massScheduleSummary: formData.get('massScheduleSummary'),
          chapelsEnabled: form.querySelector('[name="chapelsEnabled"]')?.checked || false,
          chapels: formData.get('chapels'),
        });
        window.location.reload();
      } catch (error) {
        showInlineError(
          'sa-parish-edit-error',
          error instanceof Error ? error.message : 'Erreur mise à jour paroisse.'
        );
      }
      return;
    }

    if (form.id === 'sa-admin-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const userId = String(formData.get('userId') || '');
      if (!userId) return;
      try {
        await apiJson(`/api/super-admin/admins/${encodeURIComponent(userId)}`, 'PATCH', {
          displayName: formData.get('displayName'),
          phone: formData.get('phone'),
        });
        window.location.reload();
      } catch (error) {
        showInlineError(
          'sa-admin-edit-error',
          error instanceof Error ? error.message : 'Erreur mise à jour responsable.'
        );
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
