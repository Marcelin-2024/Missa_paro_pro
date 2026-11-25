(function initParishAdminActions() {
  function csrfToken() {
    return window.missaUI?.getCsrfToken?.() || '';
  }

  function showFeedback(boxId, message, isError) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.textContent = message;
    box.className = isError ? 'alert alert-error mb-4' : 'alert alert-success mb-4';
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

    const transitionBtn = target.closest('[data-intention-transition]');
    if (transitionBtn instanceof HTMLButtonElement) {
      const nextStatus = transitionBtn.getAttribute('data-intention-transition');
      const intentionId = transitionBtn.getAttribute('data-intention-id');
      if (!nextStatus || !intentionId) return;

      const commentInput = document.querySelector(`[data-intention-comment="${intentionId}"]`);
      const messeSelect = document.querySelector(`[data-intention-messe="${intentionId}"]`);
      const internalComment = commentInput instanceof HTMLInputElement ? commentInput.value : '';
      const messeId = messeSelect instanceof HTMLSelectElement ? messeSelect.value : null;

      transitionBtn.disabled = true;
      try {
        await apiJson(`/api/parish/intentions/${encodeURIComponent(intentionId)}/status`, 'PATCH', {
          status: nextStatus,
          internalComment,
          messeId: messeId || undefined,
        });
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-intentions-feedback', 'Statut de l’intention mis à jour.', false);
      } catch (error) {
        transitionBtn.disabled = false;
        showFeedback(
          'parish-intentions-feedback',
          error instanceof Error ? error.message : 'Erreur lors de la mise à jour.',
          true
        );
      }
      return;
    }

    const messeBtn = target.closest('[data-messe-status]');
    if (messeBtn instanceof HTMLButtonElement) {
      const statut = messeBtn.getAttribute('data-messe-status');
      const messeId = messeBtn.getAttribute('data-messe-id');
      if (!statut || !messeId) return;
      messeBtn.disabled = true;
      try {
        await apiJson(`/api/parish/masses/${encodeURIComponent(messeId)}/status`, 'PATCH', { statut });
        await window.missaDashboardNav?.reloadActiveSection?.();
      } catch (error) {
        messeBtn.disabled = false;
        showFeedback(
          'parish-masses-feedback',
          error instanceof Error ? error.message : 'Erreur lors de la mise à jour de la messe.',
          true
        );
      }
      return;
    }

    const approveAnnonceBtn = target.closest('[data-approve-annonce]');
    if (approveAnnonceBtn instanceof HTMLButtonElement) {
      const annonceId = approveAnnonceBtn.getAttribute('data-approve-annonce');
      if (!annonceId) return;
      approveAnnonceBtn.disabled = true;
      try {
        await apiJson(`/api/parish/announcements/${encodeURIComponent(annonceId)}/approve`, 'PATCH');
        await window.missaDashboardNav?.reloadActiveSection?.();
      } catch (error) {
        approveAnnonceBtn.disabled = false;
        showFeedback(
          'parish-annonces-feedback',
          error instanceof Error ? error.message : 'Erreur lors de l’approbation.',
          true
        );
      }
      return;
    }

    const memStatusBtn = target.closest('[data-parish-membership-status]');
    if (memStatusBtn instanceof HTMLButtonElement) {
      const status = memStatusBtn.getAttribute('data-parish-membership-status');
      const membershipId = memStatusBtn.getAttribute('data-membership-id');
      if (!status || !membershipId) return;
      memStatusBtn.disabled = true;
      try {
        await apiJson(`/api/parish/memberships/${encodeURIComponent(membershipId)}/status`, 'PATCH', {
          status,
        });
        await window.missaDashboardNav?.reloadActiveSection?.();
      } catch (error) {
        memStatusBtn.disabled = false;
        showFeedback(
          'parish-users-feedback',
          error instanceof Error ? error.message : 'Erreur lors de la mise à jour du membre.',
          true
        );
      }
      return;
    }

    const revokeRoleBtn = target.closest('[data-revoke-role]');
    if (revokeRoleBtn instanceof HTMLButtonElement) {
      const roleCode = revokeRoleBtn.getAttribute('data-revoke-role');
      const membershipId = revokeRoleBtn.getAttribute('data-membership-id');
      if (!roleCode || !membershipId) return;
      revokeRoleBtn.disabled = true;
      try {
        await apiJson(
          `/api/parish/memberships/${encodeURIComponent(membershipId)}/roles/${encodeURIComponent(roleCode)}`,
          'DELETE'
        );
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-roles-feedback', `Rôle ${roleCode} retiré avec succès.`, false);
      } catch (error) {
        revokeRoleBtn.disabled = false;
        showFeedback(
          'parish-roles-feedback',
          error instanceof Error ? error.message : 'Impossible de retirer ce rôle.',
          true
        );
      }
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === 'parish-create-member-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const roles = formData.getAll('roles').map(String);
      try {
        const data = await apiJson('/api/parish/members', 'POST', {
          displayName: formData.get('displayName'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          titleLabel: formData.get('titleLabel'),
          roles,
        });
        await window.missaDashboardNav?.reloadActiveSection?.();
        if (data.temporaryPassword) {
          const revealBox = document.getElementById('parish-member-temp-reveal');
          const revealPass = document.getElementById('parish-member-temp-pass');
          if (revealBox && revealPass) {
            revealPass.textContent = data.temporaryPassword;
            revealBox.classList.remove('hidden');
          }
        }
        showFeedback('parish-users-feedback', 'Membre ajouté à la paroisse.', false);
      } catch (error) {
        showFeedback(
          'parish-users-feedback',
          error instanceof Error ? error.message : 'Erreur lors de l’ajout du membre.',
          true
        );
      }
      return;
    }

    if (form.hasAttribute('data-assign-role-form')) {
      event.preventDefault();
      const membershipId = form.getAttribute('data-membership-id');
      if (!membershipId) return;
      const formData = new FormData(form);
      const roleCode = String(formData.get('roleCode') || '');
      const expiresAt = String(formData.get('expiresAt') || '').trim() || null;
      if (!roleCode) return;

      try {
        await apiJson(`/api/parish/memberships/${encodeURIComponent(membershipId)}/roles`, 'POST', {
          roleCode,
          expiresAt,
        });
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-roles-feedback', `Rôle ${roleCode} attribué avec succès.`, false);
      } catch (error) {
        showFeedback(
          'parish-roles-feedback',
          error instanceof Error ? error.message : 'Erreur lors de l’attribution du rôle.',
          true
        );
      }
      return;
    }

    if (form.id === 'parish-settings-form') {
      event.preventDefault();
      const formData = new FormData(form);
      try {
        await apiJson('/api/parish/settings', 'POST', {
          phone: formData.get('phone'),
          email: formData.get('email'),
          address: formData.get('address'),
          massScheduleSummary: formData.get('massScheduleSummary'),
          chapelsEnabled: form.querySelector('[name="chapelsEnabled"]')?.checked || false,
          chapels: formData.get('chapels'),
        });
        showFeedback('parish-settings-feedback', 'Paramètres de la paroisse enregistrés.', false);
      } catch (error) {
        showFeedback(
          'parish-settings-feedback',
          error instanceof Error ? error.message : 'Erreur lors de l’enregistrement.',
          true
        );
      }
    }
  });
})();
