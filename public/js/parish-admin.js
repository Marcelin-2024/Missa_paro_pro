(function initParishAdminActions() {
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

  function formatDateFr(value, withTime = true, fallback = 'Non renseignée') {
    if (!value) return fallback;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return withTime ? dt.toLocaleString('fr-FR') : dt.toLocaleDateString('fr-FR');
  }

  function showFeedback(boxId, message, isError) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.textContent = message;
    box.className = isError ? 'alert alert-error mb-4' : 'alert alert-success mb-4';
    box.classList.remove('hidden');
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

    // --- Intentions: Detail Modal ---
    const intDetailBtn = target.closest('[data-intention-detail]');
    if (intDetailBtn instanceof HTMLButtonElement) {
      const id = intDetailBtn.getAttribute('data-intention-detail');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/intentions/${encodeURIComponent(id)}`, 'GET');
        const it = data.intention;
        setText('id-ref-sub', `${it.trackingRef} · Reçue le ${formatDateFr(it.requestedAt)}`);
        setText('id-tracking-ref', it.trackingRef);
        setText('id-status', data.statusLabel || it.status);
        setText('id-requester-name', it.requesterName);
        setText('id-requester-phone', it.requesterPhone);
        setText('id-requester-email', it.requesterEmail, 'Non renseignée');
        setText('id-type-label', data.intentionTypeLabel || 'Intention');
        setText(
          'id-amount',
          `${Number(data.effectiveAmount || 2000).toLocaleString('fr-FR')} ${data.currency || 'XOF'}`
        );
        setText('id-desired-date', it.desiredDate, 'Non précisée');
        setText('id-requested-at', formatDateFr(it.requestedAt));
        setText(
          'id-messe-info',
          data.messe
            ? `${data.messe.date} · ${data.messe.horaire} (${data.messe.celebrant}${data.messe.lieu ? `, ${data.messe.lieu}` : ''})`
            : 'Aucune messe associée'
        );
        setText(
          'id-payment-info',
          data.payment
            ? `${data.payment.statusLabel} · ${data.payment.providerName} (${data.payment.transactionReference})`
            : 'Non payée'
        );
        setText('id-processed-by', data.processedByName, 'Non traitée');
        setText('id-processed-at', formatDateFr(it.processedAt, true, 'Non traitée'));
        setText('id-celebrated-by', data.celebratedByName, 'Non célébrée');
        setText('id-celebrated-at', formatDateFr(it.celebratedAt, true, 'Non célébrée'));
        setText('id-internal-comment', it.internalComment, 'Aucune note interne');
        setText('id-objet', it.objet);
        setText('id-details', it.details);
        document.getElementById('intention-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-intentions-feedback',
          error instanceof Error ? error.message : 'Impossible de charger les détails.',
          true
        );
      }
      return;
    }

    // --- Intentions: Edit Modal ---
    const intEditBtn = target.closest('[data-intention-edit]');
    if (intEditBtn instanceof HTMLButtonElement) {
      const id = intEditBtn.getAttribute('data-intention-edit');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/intentions/${encodeURIComponent(id)}`, 'GET');
        const it = data.intention;
        showInlineError('intention-edit-error', '');
        setInputVal('ie-id', it.id);
        setInputVal('ie-requesterName', it.requesterName);
        setInputVal('ie-requesterPhone', it.requesterPhone);
        setInputVal('ie-requesterEmail', it.requesterEmail || '');
        setInputVal('ie-desiredDate', it.desiredDate || '');
        setInputVal('ie-intentionType', it.intentionType || 'MESSE_BASSE');
        setInputVal('ie-messeId', it.messeId || '');
        setInputVal('ie-objet', it.objet);
        setInputVal('ie-details', it.details);
        setInputVal('ie-internalComment', it.internalComment || '');
        document.getElementById('intention-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-intentions-feedback',
          error instanceof Error ? error.message : 'Impossible d’ouvrir le formulaire.',
          true
        );
      }
      return;
    }

    // --- Intentions: Status transition ---
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

    // --- Masses: Detail Modal ---
    const messeDetailBtn = target.closest('[data-messe-detail]');
    if (messeDetailBtn instanceof HTMLButtonElement) {
      const id = messeDetailBtn.getAttribute('data-messe-detail');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/masses/${encodeURIComponent(id)}`, 'GET');
        const m = data.messe;
        setText('msd-subtitle', `${m.date} · ${m.horaire}`);
        setText('msd-date', m.date);
        setText('msd-horaire', m.horaire);
        setText('msd-celebrant', m.celebrant);
        setText('msd-type', m.type || 'Messe paroissiale');
        setText('msd-lieu', m.lieu || 'Église paroissiale');
        setText('msd-statut', m.statut);
        setText('msd-created-by', data.createdByName || 'Secrétariat paroissial');
        setText('msd-created-at', formatDateFr(m.createdAt));
        setText('msd-intentions-count', String(data.intentionsCount || 0));

        const list = document.getElementById('msd-intentions-list');
        if (list) {
          list.innerHTML = '';
          const items = Array.isArray(data.linkedIntentions) ? data.linkedIntentions : [];
          if (items.length === 0) {
            const li = document.createElement('li');
            li.className = 'text-muted';
            li.textContent = 'Aucune intention programmée sur cette messe.';
            list.appendChild(li);
          } else {
            items.forEach((it) => {
              const li = document.createElement('li');
              li.className = 'status-breakdown-item';
              li.textContent = `${it.trackingRef} · ${it.requesterName} — ${it.objet}`;
              list.appendChild(li);
            });
          }
        }
        document.getElementById('messe-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-masses-feedback',
          error instanceof Error ? error.message : 'Impossible de charger la messe.',
          true
        );
      }
      return;
    }

    // --- Masses: Edit Modal ---
    const messeEditBtn = target.closest('[data-messe-edit]');
    if (messeEditBtn instanceof HTMLButtonElement) {
      const id = messeEditBtn.getAttribute('data-messe-edit');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/masses/${encodeURIComponent(id)}`, 'GET');
        const m = data.messe;
        showInlineError('messe-edit-error', '');
        setInputVal('mse-id', m.id);
        setInputVal('mse-type', m.type || 'Messe paroissiale');
        setInputVal('mse-statut', m.statut || 'A venir');
        setInputVal('mse-celebrant', m.celebrant);
        setInputVal('mse-lieu', m.lieu || 'Église paroissiale');
        setInputVal('mse-date', m.date);
        setInputVal('mse-horaire', m.horaire);
        document.getElementById('messe-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-masses-feedback',
          error instanceof Error ? error.message : 'Impossible d’ouvrir l’édition.',
          true
        );
      }
      return;
    }

    // --- Masses: Delete ---
    const messeDeleteBtn = target.closest('[data-messe-delete]');
    if (messeDeleteBtn instanceof HTMLButtonElement) {
      const id = messeDeleteBtn.getAttribute('data-messe-delete');
      if (!id) return;
      const confirmed = await window.missaUI?.openConfirmDialog?.({
        title: 'Supprimer cette messe',
        message: 'Voulez-vous vraiment supprimer cette messe du calendrier paroissial ?',
        confirmLabel: 'Supprimer',
      });
      if (!confirmed) return;

      messeDeleteBtn.disabled = true;
      try {
        await apiJson(`/api/parish/masses/${encodeURIComponent(id)}`, 'DELETE');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-masses-feedback', 'Messe supprimée.', false);
      } catch (error) {
        messeDeleteBtn.disabled = false;
        showFeedback(
          'parish-masses-feedback',
          error instanceof Error ? error.message : 'Suppression impossible.',
          true
        );
      }
      return;
    }

    // --- Masses: Quick Status ---
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

    // --- Announcements: Detail Modal ---
    const annDetailBtn = target.closest('[data-annonce-detail]');
    if (annDetailBtn instanceof HTMLButtonElement) {
      const id = annDetailBtn.getAttribute('data-annonce-detail');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/announcements/${encodeURIComponent(id)}`, 'GET');
        const a = data.annonce;
        setText('ad-date-sub', `${data.typeLabel || a.type} · ${a.dateAnnonce}`);
        setText('ad-type', data.typeLabel || a.type);
        setText('ad-statut', a.statut);
        setText('ad-date', a.dateAnnonce);
        setText('ad-created-by', data.createdByName || 'Secrétariat');
        setText('ad-approved-by', data.approvedByName || 'En attente / Non requis');
        setText('ad-created-at', formatDateFr(a.createdAt));
        setText('ad-titre', a.titre);
        setText('ad-contenu', a.contenu);

        const img = document.getElementById('ad-image');
        if (img instanceof HTMLImageElement) {
          if (a.imageUrl) {
            img.src = a.imageUrl;
            img.classList.remove('hidden');
          } else {
            img.src = '#';
            img.classList.add('hidden');
          }
        }
        document.getElementById('annonce-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-annonces-feedback',
          error instanceof Error ? error.message : 'Impossible de charger l’annonce.',
          true
        );
      }
      return;
    }

    // --- Announcements: Edit Modal ---
    const annEditBtn = target.closest('[data-annonce-edit]');
    if (annEditBtn instanceof HTMLButtonElement) {
      const id = annEditBtn.getAttribute('data-annonce-edit');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/announcements/${encodeURIComponent(id)}`, 'GET');
        const a = data.annonce;
        showInlineError('annonce-edit-error', '');
        setInputVal('ae-id', a.id);
        setInputVal('ae-type', a.type || 'Communique');
        setInputVal('ae-date', a.dateAnnonce);
        setInputVal('ae-titre', a.titre);
        setInputVal('ae-statut', a.statut || 'PUBLISHED');
        setInputVal('ae-contenu', a.contenu);
        document.getElementById('annonce-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-annonces-feedback',
          error instanceof Error ? error.message : 'Impossible d’ouvrir l’édition.',
          true
        );
      }
      return;
    }

    // --- Announcements: Approve / Archive / Delete ---
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

    const archiveAnnonceBtn = target.closest('[data-annonce-archive]');
    if (archiveAnnonceBtn instanceof HTMLButtonElement) {
      const id = archiveAnnonceBtn.getAttribute('data-annonce-archive');
      if (!id) return;
      archiveAnnonceBtn.disabled = true;
      try {
        await apiJson(`/api/parish/announcements/${encodeURIComponent(id)}/archive`, 'PATCH');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-annonces-feedback', 'Annonce archivée.', false);
      } catch (error) {
        archiveAnnonceBtn.disabled = false;
        showFeedback(
          'parish-annonces-feedback',
          error instanceof Error ? error.message : 'Erreur lors de l’archivage.',
          true
        );
      }
      return;
    }

    const deleteAnnonceBtn = target.closest('[data-annonce-delete]');
    if (deleteAnnonceBtn instanceof HTMLButtonElement) {
      const id = deleteAnnonceBtn.getAttribute('data-annonce-delete');
      if (!id) return;
      const confirmed = await window.missaUI?.openConfirmDialog?.({
        title: 'Supprimer cette annonce',
        message: 'Voulez-vous vraiment supprimer cette annonce paroissiale ?',
        confirmLabel: 'Supprimer',
      });
      if (!confirmed) return;

      deleteAnnonceBtn.disabled = true;
      try {
        await apiJson(`/api/parish/announcements/${encodeURIComponent(id)}`, 'DELETE');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-annonces-feedback', 'Annonce supprimée.', false);
      } catch (error) {
        deleteAnnonceBtn.disabled = false;
        showFeedback(
          'parish-annonces-feedback',
          error instanceof Error ? error.message : 'Suppression impossible.',
          true
        );
      }
      return;
    }

    // --- Members: Detail Modal ---
    const memberDetailBtn = target.closest('[data-member-detail]');
    if (memberDetailBtn instanceof HTMLButtonElement) {
      const id = memberDetailBtn.getAttribute('data-member-detail');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/memberships/${encodeURIComponent(id)}`, 'GET');
        const m = data.member;
        setText('md-email-sub', m.user.email);
        setText('md-name', m.user.displayName);
        setText('md-email', m.user.email);
        setText('md-phone', m.user.phone, 'Non renseigné');
        setText('md-title', m.membership.titleLabel, 'Membre paroissial');
        setText('md-account-status', m.user.status);
        setText('md-membership-status', m.membership.status);
        setText('md-created-at', formatDateFr(m.user.createdAt));
        setText('md-last-login', formatDateFr(m.user.lastLoginAt, true, 'Jamais connecté'));

        const rolesList = document.getElementById('md-roles-list');
        if (rolesList) {
          rolesList.innerHTML = '';
          const roleLabels = Array.isArray(m.roleLabels) ? m.roleLabels : [];
          if (roleLabels.length === 0) {
            const span = document.createElement('span');
            span.className = 'text-muted';
            span.textContent = 'Aucun rôle actif';
            rolesList.appendChild(span);
          } else {
            roleLabels.forEach((r) => {
              const span = document.createElement('span');
              span.className = 'role-chip role-chip-primary';
              span.textContent = r.label || r.code;
              rolesList.appendChild(span);
            });
          }
        }

        const permsList = document.getElementById('md-permissions-list');
        if (permsList) {
          permsList.innerHTML = '';
          const permItems = Array.isArray(m.permissionDetails) ? m.permissionDetails : [];
          if (permItems.length === 0) {
            const li = document.createElement('li');
            li.className = 'text-muted';
            li.textContent = 'Aucune permission effective.';
            permsList.appendChild(li);
          } else {
            permItems.forEach((p) => {
              const li = document.createElement('li');
              li.className = 'permission-chip-item';
              li.textContent = p.label || p.code;
              permsList.appendChild(li);
            });
          }
        }
        document.getElementById('member-detail-modal')?.classList.remove('hidden');
      } catch (error) {
        const feedbackId = document.getElementById('parish-users-feedback')
          ? 'parish-users-feedback'
          : 'parish-roles-feedback';
        showFeedback(
          feedbackId,
          error instanceof Error ? error.message : 'Impossible de charger la fiche membre.',
          true
        );
      }
      return;
    }

    // --- Members: Edit Modal ---
    const memberEditBtn = target.closest('[data-member-edit]');
    if (memberEditBtn instanceof HTMLButtonElement) {
      const id = memberEditBtn.getAttribute('data-member-edit');
      if (!id) return;
      try {
        const data = await apiJson(`/api/parish/memberships/${encodeURIComponent(id)}`, 'GET');
        const m = data.member;
        showInlineError('member-edit-error', '');
        setInputVal('me-membership-id', m.membership.id);
        setInputVal('me-displayName', m.user.displayName);
        setInputVal('me-phone', m.user.phone || '');
        setInputVal('me-titleLabel', m.membership.titleLabel || '');
        document.getElementById('member-edit-modal')?.classList.remove('hidden');
      } catch (error) {
        showFeedback(
          'parish-users-feedback',
          error instanceof Error ? error.message : 'Impossible d’ouvrir la modification.',
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

  document.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.hasAttribute('data-intention-messe')) return;

    const intentionId = target.getAttribute('data-intention-messe');
    if (!intentionId) return;
    const controls = target.closest('[data-intention-controls]');
    const isAcceptStage = controls?.querySelector('[data-intention-transition="SCHEDULED"]');
    if (isAcceptStage) return; // Wait for "Programmer sur messe" button when ACCEPTED

    try {
      await apiJson(`/api/parish/intentions/${encodeURIComponent(intentionId)}`, 'PATCH', {
        messeId: target.value || null,
      });
      await window.missaDashboardNav?.reloadActiveSection?.();
      showFeedback('parish-intentions-feedback', 'Messe associée mise à jour.', false);
    } catch (error) {
      showFeedback(
        'parish-intentions-feedback',
        error instanceof Error ? error.message : 'Impossible de modifier la messe associée.',
        true
      );
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === 'intention-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const id = String(formData.get('id') || '');
      if (!id) return;
      try {
        await apiJson(`/api/parish/intentions/${encodeURIComponent(id)}`, 'PATCH', {
          requesterName: formData.get('requesterName'),
          requesterPhone: formData.get('requesterPhone'),
          requesterEmail: formData.get('requesterEmail'),
          desiredDate: String(formData.get('desiredDate') || '').trim() || null,
          intentionType: formData.get('intentionType'),
          messeId: String(formData.get('messeId') || '').trim() || null,
          objet: formData.get('objet'),
          details: formData.get('details'),
          internalComment: formData.get('internalComment'),
        });
        document.getElementById('intention-edit-modal')?.classList.add('hidden');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-intentions-feedback', 'Intention mise à jour avec succès.', false);
      } catch (error) {
        showInlineError(
          'intention-edit-error',
          error instanceof Error ? error.message : 'Erreur lors de la modification.'
        );
      }
      return;
    }

    if (form.id === 'messe-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const id = String(formData.get('id') || '');
      if (!id) return;
      try {
        await apiJson(`/api/parish/masses/${encodeURIComponent(id)}`, 'PATCH', {
          type: formData.get('type'),
          statut: formData.get('statut'),
          celebrant: formData.get('celebrant'),
          lieu: formData.get('lieu'),
          date: formData.get('date'),
          horaire: formData.get('horaire'),
        });
        document.getElementById('messe-edit-modal')?.classList.add('hidden');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-masses-feedback', 'Messe mise à jour avec succès.', false);
      } catch (error) {
        showInlineError(
          'messe-edit-error',
          error instanceof Error ? error.message : 'Erreur lors de la modification de la messe.'
        );
      }
      return;
    }

    if (form.id === 'annonce-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const id = String(formData.get('id') || '');
      if (!id) return;
      try {
        await apiJson(`/api/parish/announcements/${encodeURIComponent(id)}`, 'PATCH', {
          type: formData.get('type'),
          dateAnnonce: formData.get('dateAnnonce'),
          titre: formData.get('titre'),
          statut: formData.get('statut'),
          contenu: formData.get('contenu'),
        });
        document.getElementById('annonce-edit-modal')?.classList.add('hidden');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-annonces-feedback', 'Annonce mise à jour avec succès.', false);
      } catch (error) {
        showInlineError(
          'annonce-edit-error',
          error instanceof Error ? error.message : 'Erreur lors de la modification de l’annonce.'
        );
      }
      return;
    }

    if (form.id === 'member-edit-form') {
      event.preventDefault();
      const formData = new FormData(form);
      const membershipId = String(formData.get('membershipId') || '');
      if (!membershipId) return;
      try {
        await apiJson(`/api/parish/memberships/${encodeURIComponent(membershipId)}`, 'PATCH', {
          displayName: formData.get('displayName'),
          phone: formData.get('phone'),
          titleLabel: formData.get('titleLabel'),
        });
        document.getElementById('member-edit-modal')?.classList.add('hidden');
        await window.missaDashboardNav?.reloadActiveSection?.();
        showFeedback('parish-users-feedback', 'Informations du membre mises à jour.', false);
      } catch (error) {
        showInlineError(
          'member-edit-error',
          error instanceof Error ? error.message : 'Erreur lors de la mise à jour.'
        );
      }
      return;
    }

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
          location: formData.get('location'),
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
