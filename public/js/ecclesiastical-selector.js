(function initEcclesiasticalSelector() {
  const MISSING_PARISH_VALUE = '__missing__';

  const pickerContainer =
    document.querySelector('[data-ecclesiastical-picker]') ||
    document.querySelector('form[action="/page/valide"]');

  if (!pickerContainer) {
    return;
  }

  const form =
    pickerContainer instanceof HTMLFormElement
      ? pickerContainer
      : pickerContainer.querySelector('form');
  const provinceSelect = pickerContainer.querySelector('#provinceId');
  const dioceseSelect = pickerContainer.querySelector('#dioceseId');
  const parishSearchInput = pickerContainer.querySelector('#parish-search-input');
  const parishSelect = pickerContainer.querySelector('#parishId');
  const dioceseHelper = pickerContainer.querySelector('#diocese-helper');
  const parishHelper = pickerContainer.querySelector('#parish-helper');
  const parishEmptyState = pickerContainer.querySelector('#parish-empty-state');
  const parishEmptyText = pickerContainer.querySelector('#parish-empty-text');
  const useMissingParishBtn = pickerContainer.querySelector('#use-missing-parish-btn');
  const missingParishBox = pickerContainer.querySelector('#missing-parish-box');
  const missingParishInput = pickerContainer.querySelector('#missing_parish_name');
  const parishRequestIdInput = pickerContainer.querySelector('#parish_request_id');
  const ecclesiasticalError = pickerContainer.querySelector('#ecclesiastical-error');

  const supportsMissingOption = Boolean(missingParishBox);
  const isPublicRegistrationForm =
    form instanceof HTMLFormElement && form.getAttribute('action') === '/page/valide';

  if (
    !(provinceSelect instanceof HTMLSelectElement) ||
    !(dioceseSelect instanceof HTMLSelectElement) ||
    !(parishSelect instanceof HTMLSelectElement)
  ) {
    return;
  }

  let loadedParishes = [];
  let currentDioceseMeta = null;
  let activeDioceseRequestToken = 0;
  let activeParishRequestToken = 0;
  let isSubmittingPendingRequest = false;

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’`-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function showError(message, focusTarget) {
    if (ecclesiasticalError) {
      ecclesiasticalError.textContent = message;
      ecclesiasticalError.classList.remove('hidden');
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.classList.add('is-invalid');
      focusTarget.focus();
    }
  }

  function clearError() {
    if (ecclesiasticalError) {
      ecclesiasticalError.textContent = '';
      ecclesiasticalError.classList.add('hidden');
    }
    provinceSelect.classList.remove('is-invalid');
    dioceseSelect.classList.remove('is-invalid');
    parishSelect.classList.remove('is-invalid');
    if (missingParishInput instanceof HTMLInputElement) {
      missingParishInput.classList.remove('is-invalid');
    }
  }

  function hideMissingParishBox() {
    if (missingParishBox) {
      missingParishBox.classList.add('hidden');
    }
    if (missingParishInput instanceof HTMLInputElement) {
      missingParishInput.required = false;
      missingParishInput.value = '';
      missingParishInput.classList.remove('is-invalid');
    }
    if (parishRequestIdInput instanceof HTMLInputElement) {
      parishRequestIdInput.value = '';
    }
  }

  function showMissingParishBox(shouldFocus) {
    if (missingParishBox) {
      missingParishBox.classList.remove('hidden');
    }
    if (missingParishInput instanceof HTMLInputElement) {
      missingParishInput.required = true;
      if (shouldFocus) {
        missingParishInput.focus();
      }
    }
  }

  function setEmptyState(visible, message) {
    if (!parishEmptyState) return;
    if (parishEmptyText && message) {
      parishEmptyText.textContent = message;
    }
    parishEmptyState.classList.toggle('hidden', !visible);
  }

  function resetDioceseSelect(placeholderText) {
    dioceseSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholderText || 'Sélectionnez votre diocèse';
    dioceseSelect.appendChild(opt);
    dioceseSelect.value = '';
    dioceseSelect.disabled = true;
    if (dioceseHelper) {
      dioceseHelper.textContent = 'Choisissez d’abord une province ecclésiastique.';
    }
  }

  function resetParishControls(placeholderText) {
    loadedParishes = [];
    currentDioceseMeta = null;
    if (parishSearchInput instanceof HTMLInputElement) {
      parishSearchInput.value = '';
      parishSearchInput.disabled = true;
    }
    parishSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholderText || 'Sélectionnez votre paroisse';
    parishSelect.appendChild(opt);
    parishSelect.value = '';
    parishSelect.disabled = true;
    if (parishHelper) {
      parishHelper.textContent = 'Choisissez d’abord un diocèse.';
    }
    setEmptyState(false);
    hideMissingParishBox();
  }

  function formatParishLabel(parish) {
    const parts = [parish.name];
    if (parish.location && normalizeText(parish.location) !== normalizeText(parish.name)) {
      parts.push(`(${parish.location})`);
    }
    return parts.join(' ');
  }

  function renderParishOptions(searchTerm) {
    const previousValue = parishSelect.value;
    const term = normalizeText(searchTerm);

    const filtered = term
      ? loadedParishes.filter((parish) => {
          const haystack = [
            parish.name,
            parish.location,
            parish.pastoralSectorOrDeanery || '',
            ...(Array.isArray(parish.aliases) ? parish.aliases : []),
          ]
            .map(normalizeText)
            .join(' ');
          return haystack.includes(term);
        })
      : loadedParishes;

    parishSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent =
      filtered.length > 0
        ? 'Sélectionnez votre paroisse'
        : supportsMissingOption
          ? 'Aucune paroisse correspondante — utilisez l’option ci-dessous'
          : 'Aucune paroisse correspondante dans ce diocèse';
    parishSelect.appendChild(defaultOption);

    filtered.forEach((parish) => {
      const option = document.createElement('option');
      option.value = parish.id;
      option.textContent = formatParishLabel(parish);
      parishSelect.appendChild(option);
    });

    if (supportsMissingOption) {
      const missingOption = document.createElement('option');
      missingOption.value = MISSING_PARISH_VALUE;
      missingOption.textContent = 'Je ne trouve pas ma paroisse';
      parishSelect.appendChild(missingOption);
    }

    if (
      previousValue &&
      Array.from(parishSelect.options).some((option) => option.value === previousValue)
    ) {
      parishSelect.value = previousValue;
    } else {
      parishSelect.value = '';
      if (previousValue !== MISSING_PARISH_VALUE) {
        hideMissingParishBox();
      }
    }

    if (loadedParishes.length === 0) {
      setEmptyState(
        true,
        'Aucune paroisse officielle n’est encore répertoriée pour ce diocèse.'
      );
    } else if (filtered.length === 0) {
      setEmptyState(
        true,
        'Aucune paroisse ne correspond à votre recherche dans ce diocèse.'
      );
    } else {
      setEmptyState(false);
    }

    if (parishHelper && currentDioceseMeta) {
      const countText = `${filtered.length} paroisse${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''} sur ${loadedParishes.length} répertoriée${loadedParishes.length > 1 ? 's' : ''}`;
      if (currentDioceseMeta.directoryCompleteness !== 'COMPLETE' && currentDioceseMeta.coverageNote) {
        parishHelper.textContent = `${countText}. ${currentDioceseMeta.coverageNote}`;
      } else {
        parishHelper.textContent = countText;
      }
    }
  }

  async function handleProvinceChange() {
    clearError();
    const provinceId = provinceSelect.value.trim();

    activeDioceseRequestToken += 1;
    activeParishRequestToken += 1;
    const requestToken = activeDioceseRequestToken;

    resetParishControls('Sélectionnez votre paroisse');

    if (!provinceId) {
      resetDioceseSelect('Sélectionnez votre diocèse');
      return;
    }

    resetDioceseSelect('Chargement des diocèses...');
    if (dioceseHelper) {
      dioceseHelper.textContent = 'Chargement des diocèses de la province...';
    }

    try {
      const response = await fetch(
        `/api/ecclesiastical/dioceses?provinceId=${encodeURIComponent(provinceId)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (requestToken !== activeDioceseRequestToken) return;

      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.dioceses)) {
        throw new Error(payload.error || 'Impossible de charger les diocèses.');
      }

      dioceseSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Sélectionnez votre diocèse';
      dioceseSelect.appendChild(placeholder);

      payload.dioceses.forEach((diocese) => {
        const option = document.createElement('option');
        option.value = diocese.id;
        option.textContent = diocese.name;
        dioceseSelect.appendChild(option);
      });

      dioceseSelect.disabled = false;
      if (dioceseHelper) {
        dioceseHelper.textContent = `${payload.dioceses.length} diocèse${payload.dioceses.length > 1 ? 's' : ''} disponible${payload.dioceses.length > 1 ? 's' : ''}.`;
      }
    } catch (error) {
      if (requestToken !== activeDioceseRequestToken) return;
      resetDioceseSelect('Sélectionnez votre diocèse');
      showError(
        error instanceof Error
          ? error.message
          : 'Erreur lors du chargement des diocèses.',
        provinceSelect
      );
    }
  }

  async function handleDioceseChange() {
    clearError();
    const dioceseId = dioceseSelect.value.trim();

    activeParishRequestToken += 1;
    const requestToken = activeParishRequestToken;

    resetParishControls('Sélectionnez votre paroisse');

    if (!dioceseId) {
      return;
    }

    resetParishControls('Chargement des paroisses...');
    if (parishHelper) {
      parishHelper.textContent = 'Chargement des paroisses du diocèse...';
    }

    try {
      const response = await fetch(
        `/api/ecclesiastical/parishes?dioceseId=${encodeURIComponent(dioceseId)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (requestToken !== activeParishRequestToken) return;

      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.parishes)) {
        throw new Error(payload.error || 'Impossible de charger les paroisses.');
      }

      loadedParishes = payload.parishes;
      currentDioceseMeta = payload.diocese || null;

      if (parishSearchInput instanceof HTMLInputElement) {
        parishSearchInput.disabled = false;
      }
      parishSelect.disabled = false;
      renderParishOptions('');
    } catch (error) {
      if (requestToken !== activeParishRequestToken) return;
      resetParishControls('Sélectionnez votre paroisse');
      showError(
        error instanceof Error
          ? error.message
          : 'Erreur lors du chargement des paroisses.',
        dioceseSelect
      );
    }
  }

  function handleParishChange() {
    clearError();
    if (supportsMissingOption && parishSelect.value === MISSING_PARISH_VALUE) {
      showMissingParishBox(true);
    } else {
      hideMissingParishBox();
    }
  }

  provinceSelect.addEventListener('change', handleProvinceChange);
  dioceseSelect.addEventListener('change', handleDioceseChange);
  parishSelect.addEventListener('change', handleParishChange);

  if (parishSearchInput instanceof HTMLInputElement) {
    parishSearchInput.addEventListener('input', () => {
      clearError();
      renderParishOptions(parishSearchInput.value);
    });
  }

  if (useMissingParishBtn instanceof HTMLButtonElement && supportsMissingOption) {
    useMissingParishBtn.addEventListener('click', () => {
      clearError();
      parishSelect.value = MISSING_PARISH_VALUE;
      showMissingParishBox(true);
      if (
        missingParishInput instanceof HTMLInputElement &&
        parishSearchInput instanceof HTMLInputElement &&
        parishSearchInput.value.trim().length >= 2 &&
        !missingParishInput.value.trim()
      ) {
        missingParishInput.value = parishSearchInput.value.trim();
      }
    });
  }

  if (missingParishInput instanceof HTMLInputElement) {
    missingParishInput.addEventListener('input', () => {
      if (parishRequestIdInput instanceof HTMLInputElement) {
        parishRequestIdInput.value = '';
      }
      clearError();
    });
  }

  if (isPublicRegistrationForm && form) {
    form.addEventListener('submit', async (event) => {
      if (isSubmittingPendingRequest) {
        return;
      }

      clearError();

      const provinceId = provinceSelect.value.trim();
      const dioceseId = dioceseSelect.value.trim();
      const parishId = parishSelect.value.trim();

      if (!provinceId) {
        event.preventDefault();
        showError('Veuillez sélectionner votre province ecclésiastique.', provinceSelect);
        return;
      }

      if (!dioceseId) {
        event.preventDefault();
        showError('Veuillez sélectionner votre diocèse.', dioceseSelect);
        return;
      }

      if (!parishId) {
        event.preventDefault();
        showError(
          'Veuillez sélectionner votre paroisse ou choisir « Je ne trouve pas ma paroisse ».',
          parishSelect
        );
        return;
      }

      if (parishId === MISSING_PARISH_VALUE) {
        const missingName =
          missingParishInput instanceof HTMLInputElement ? missingParishInput.value.trim() : '';
        if (missingName.length < 2) {
          event.preventDefault();
          showError(
            'Veuillez saisir le nom de votre paroisse (au moins 2 caractères).',
            missingParishInput
          );
          return;
        }

        const pw = form.querySelector('#motdepasse');
        const confirmPw = form.querySelector('#confirmationmotdepasse');
        if (
          pw instanceof HTMLInputElement &&
          confirmPw instanceof HTMLInputElement &&
          pw.value !== confirmPw.value
        ) {
          return;
        }

        const existingRequestId =
          parishRequestIdInput instanceof HTMLInputElement
            ? parishRequestIdInput.value.trim()
            : '';

        if (!existingRequestId) {
          event.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn instanceof HTMLButtonElement) {
            submitBtn.classList.add('is-loading');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Enregistrement...';
          }

          try {
            const response = await fetch('/api/ecclesiastical/parish-requests', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                provinceId,
                dioceseId,
                parishName: missingName,
              }),
            });

            const payload = await response.json();
            if (!response.ok || !payload.request || !payload.request.id) {
              throw new Error(
                payload.error || 'Impossible d’enregistrer la demande de paroisse.'
              );
            }

            if (parishRequestIdInput instanceof HTMLInputElement) {
              parishRequestIdInput.value = payload.request.id;
            }

            isSubmittingPendingRequest = true;
            form.submit();
          } catch (error) {
            if (submitBtn instanceof HTMLButtonElement) {
              submitBtn.classList.remove('is-loading');
              submitBtn.disabled = false;
              submitBtn.textContent = 'Créer mon compte fidèle';
            }
            showError(
              error instanceof Error
                ? error.message
                : 'Impossible d’enregistrer votre demande de paroisse.',
              missingParishInput
            );
          }
        }
      }
    });
  }
})();
