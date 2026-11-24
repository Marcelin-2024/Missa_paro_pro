import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const ADMIN_EMAIL = 'settaocram@gmail.com';
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface MesseDoc {
  id: string;
  date: string;
  horaire: string;
  celebrant: string;
  paroisse: string;
  statut: 'A venir' | 'Passée' | 'Annulée';
}

export interface AnnonceDoc {
  id: string;
  type: 'evenement' | 'Deces' | 'Communique' | 'Solennite';
  titre: string;
  dateAnnonce: string;
  contenu: string;
}

export interface IntentionDoc {
  id: string;
  fideleId: string;
  fideleNom: string;
  messeId: string;
  messeDate: string;
  messeHoraire: string;
  celebrant: string;
  objetIntention: string;
  detailIntention: string;
  statut: 'en attente' | 'validé' | 'annulée';
}

let currentUser: User | null = null;
let liveMesses: MesseDoc[] = [];
let liveAnnonces: AnnonceDoc[] = [];
let liveIntentions: IntentionDoc[] = [];
let unsubMesses: Unsubscribe | null = null;
let unsubAnnonces: Unsubscribe | null = null;
let unsubIntentions: Unsubscribe | null = null;

function sanitizeText(val: string, maxLength: number): string {
  return String(val || '').trim().slice(0, maxLength);
}

function makeSafeId(prefix: string): string {
  const raw = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return VALID_ID_REGEX.test(raw) ? raw.slice(0, 128) : `${prefix}-${Date.now()}`;
}

function isAdminUser(user: User | null): boolean {
  return Boolean(user && user.email === ADMIN_EMAIL && user.emailVerified);
}

const inFlightProfileChecks = new Map<string, Promise<void>>();

async function ensureUserProfile(user: User): Promise<void> {
  if (!user.emailVerified) return;

  const existingPromise = inFlightProfileChecks.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async () => {
    const userPath = `users/${user.uid}`;
    const privatePath = `users/${user.uid}/private/info`;

    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: sanitizeText(user.displayName || user.email || 'Fidèle', 120),
          paroisse: 'Sainte Rita',
          diocese: 'Abidjan',
          role: 'fidele',
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }

    try {
      const privateRef = doc(db, 'users', user.uid, 'private', 'info');
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid: user.uid,
          email: sanitizeText(user.email || '', 200),
          telephone: sanitizeText(user.phoneNumber || '', 30),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  })().finally(() => {
    inFlightProfileChecks.delete(user.uid);
  });

  inFlightProfileChecks.set(user.uid, run);
  return run;
}

async function seedDefaultMessesIfAdmin(user: User, existingCount: number): Promise<void> {
  if (!isAdminUser(user) || existingCount > 0) return;
  const defaults: Array<Omit<MesseDoc, 'id'> & { id: string }> = [
    {
      id: 'messe-1',
      date: '2026-11-29',
      horaire: '08H-10H',
      celebrant: 'Père Martin',
      paroisse: 'Sainte Rita',
      statut: 'A venir',
    },
    {
      id: 'messe-2',
      date: '2026-11-29',
      horaire: '10H-12H',
      celebrant: 'Père Francois',
      paroisse: 'Sainte Rita',
      statut: 'A venir',
    },
    {
      id: 'messe-3',
      date: '2026-12-06',
      horaire: '18H-19H30',
      celebrant: 'Henri du bois',
      paroisse: 'Sainte Rita',
      statut: 'A venir',
    },
  ];

  for (const m of defaults) {
    const path = `messes/${m.id}`;
    try {
      await setDoc(doc(db, 'messes', m.id), {
        date: m.date,
        horaire: m.horaire,
        celebrant: m.celebrant,
        paroisse: m.paroisse,
        statut: m.statut,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

function stopListeners(): void {
  unsubMesses?.();
  unsubAnnonces?.();
  unsubIntentions?.();
  unsubMesses = null;
  unsubAnnonces = null;
  unsubIntentions = null;
}

function startListeners(user: User): void {
  stopListeners();

  const messesQuery = query(
    collection(db, 'messes'),
    where('statut', 'in', ['A venir', 'Passée', 'Annulée'])
  );
  let seededChecked = false;
  unsubMesses = onSnapshot(
    messesQuery,
    (snapshot) => {
      liveMesses = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<MesseDoc, 'id'>),
      }));
      if (!seededChecked) {
        seededChecked = true;
        void seedDefaultMessesIfAdmin(user, liveMesses.length);
      }
      renderActiveDashboardElements();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messes');
    }
  );

  const annoncesQuery = query(
    collection(db, 'annonces'),
    where('type', 'in', ['evenement', 'Deces', 'Communique', 'Solennite'])
  );
  unsubAnnonces = onSnapshot(
    annoncesQuery,
    (snapshot) => {
      liveAnnonces = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AnnonceDoc, 'id'>),
      }));
      renderActiveDashboardElements();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'annonces');
    }
  );

  const intentionsQuery = isAdminUser(user)
    ? query(collection(db, 'intentions'))
    : query(collection(db, 'intentions'), where('fideleId', '==', user.uid));

  unsubIntentions = onSnapshot(
    intentionsQuery,
    (snapshot) => {
      liveIntentions = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<IntentionDoc, 'id'>),
      }));
      renderActiveDashboardElements();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'intentions');
    }
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderStatusBadge(statut: string): string {
  const normalized = statut.toLowerCase();
  let badgeClass = 'badge-warning';
  if (normalized === 'a venir') {
    badgeClass = 'badge-info';
  } else if (normalized === 'validé' || normalized === 'validée') {
    badgeClass = 'badge-success';
  } else if (normalized === 'annulée' || normalized === 'annulee') {
    badgeClass = 'badge-danger';
  } else if (normalized === 'passée' || normalized === 'passee') {
    badgeClass = 'badge-neutral';
  }
  return `<span class="badge ${badgeClass}">${escapeHtml(statut)}</span>`;
}

function renderActiveDashboardElements(): void {
  const authStatusEl = document.getElementById('firebase-auth-status');
  const authBtnEl = document.getElementById('firebase-auth-action');
  if (authStatusEl && authBtnEl) {
    if (currentUser) {
      authStatusEl.textContent = `Connecté : ${currentUser.displayName || currentUser.email} (${isAdminUser(currentUser) ? 'Admin Paroisse' : 'Fidèle'})`;
      authBtnEl.textContent = 'Déconnecter Firebase';
    } else {
      authStatusEl.textContent = 'Mode hors-ligne Firebase — Connectez-vous avec Google pour synchroniser Firestore';
      authBtnEl.textContent = 'Connexion Google (Firebase)';
    }
  }

  const headerWelcome = document.getElementById('header-welcome-name');
  if (headerWelcome && currentUser) {
    headerWelcome.textContent = `Bienvenue ${currentUser.displayName || currentUser.email || 'Fidèle'}`;
  }

  // Update dashboard stats if contenue1 is rendered
  const pendingEl = document.getElementById('stat-pending-count');
  const validatedEl = document.getElementById('stat-validated-count');
  const messesCountEl = document.getElementById('stat-messes-count');
  const annoncesCountEl = document.getElementById('stat-annonces-count');
  const weeklyTotalEl = document.getElementById('stat-weekly-total');

  if (currentUser && pendingEl && validatedEl && messesCountEl && annoncesCountEl && weeklyTotalEl) {
    const pending = liveIntentions.filter((i) => i.statut === 'en attente').length;
    const validated = liveIntentions.filter((i) => i.statut === 'validé').length;
    pendingEl.textContent = String(pending);
    validatedEl.textContent = String(validated);
    messesCountEl.textContent = String(liveMesses.filter((m) => m.statut === 'A venir').length);
    annoncesCountEl.textContent = String(liveAnnonces.length);
    weeklyTotalEl.textContent = String(liveIntentions.length);
  }

  const recentTableBody = document.getElementById('recent-intentions-body');
  if (currentUser && recentTableBody) {
    if (liveIntentions.length === 0) {
      recentTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">Aucune intention enregistrée</td></tr>';
    } else {
      recentTableBody.innerHTML = liveIntentions
        .slice(0, 4)
        .map(
          (item) => `
          <tr>
            <td>${escapeHtml(item.messeDate)}</td>
            <td>${escapeHtml(item.messeHoraire)}</td>
            <td>${escapeHtml(item.celebrant)}</td>
            <td>${renderStatusBadge(item.statut)}</td>
          </tr>`
        )
        .join('');
    }
  }

  // Update messe selector inside contenue2 intention form
  const messeSelect = document.getElementById('intention-messe-select') as HTMLSelectElement | null;
  if (messeSelect) {
    if (liveMesses.length === 0) {
      messeSelect.innerHTML = '<option value="">Aucune messe disponible (un administrateur doit en créer une)</option>';
    } else {
      messeSelect.innerHTML = liveMesses
        .map(
          (m) =>
            `<option value="${escapeHtml(m.id)}">${escapeHtml(m.date)} · ${escapeHtml(m.horaire)} — ${escapeHtml(m.celebrant)}</option>`
        )
        .join('');
    }
  }

  // Update intentions table in contenue2
  const intentionsBody = document.getElementById('intentions-table-body');
  if (currentUser && intentionsBody) {
    if (liveIntentions.length === 0) {
      intentionsBody.innerHTML =
        '<tr><td colspan="5" class="empty-state">Aucune intention de messe dans Firestore pour le moment.</td></tr>';
    } else {
      const admin = isAdminUser(currentUser);
      intentionsBody.innerHTML = liveIntentions
        .map((item) => {
          const canOwnerEdit = item.fideleId === currentUser?.uid && item.statut === 'en attente';
          const actions: string[] = [];
          if (admin && item.statut === 'en attente') {
            actions.push(
              `<button type="button" class="btn btn-primary btn-sm" data-action="validate-intention" data-id="${escapeHtml(item.id)}">Valider</button>`
            );
            actions.push(
              `<button type="button" class="btn btn-danger btn-sm" data-action="cancel-intention" data-id="${escapeHtml(item.id)}">Annuler</button>`
            );
          }
          if (canOwnerEdit) {
            actions.push(
              `<button type="button" class="btn btn-outline btn-sm" data-action="edit-intention" data-id="${escapeHtml(item.id)}">Modifier</button>`
            );
          }
          if (canOwnerEdit || admin) {
            actions.push(
              `<button type="button" class="btn btn-danger btn-sm" data-action="delete-intention" data-id="${escapeHtml(item.id)}">Supprimer</button>`
            );
          }
          return `
            <tr>
              <td>${escapeHtml(item.messeDate)}</td>
              <td>${escapeHtml(item.messeHoraire)}</td>
              <td>
                <span class="table-cell-title">${escapeHtml(item.objetIntention)}</span>
                <span class="table-cell-sub">${escapeHtml(item.celebrant)} — ${escapeHtml(item.detailIntention)}</span>
              </td>
              <td>${renderStatusBadge(item.statut)}</td>
              <td><div class="table-actions">${actions.join('') || '<span class="text-muted">Aucune action</span>'}</div></td>
            </tr>`;
        })
        .join('');
    }
  }

  // Update messes table in contenue3
  const messesBody = document.getElementById('messes-table-body');
  if (currentUser && messesBody && liveMesses.length > 0) {
    messesBody.innerHTML = liveMesses
      .map(
        (m) => `
        <tr>
          <td>${escapeHtml(m.date)}</td>
          <td>${escapeHtml(m.horaire)}</td>
          <td>${escapeHtml(m.celebrant)}</td>
          <td>${renderStatusBadge(m.statut)}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-goto-intentions>Voir intentions</button></td>
        </tr>`
      )
      .join('');
  }

  // Update annonces grid in contenue4
  const annoncesGrid = document.getElementById('annonces-cards-grid');
  if (currentUser && annoncesGrid && liveAnnonces.length > 0) {
    annoncesGrid.innerHTML = liveAnnonces
      .map(
        (a) => `
        <article class="annonce-card" data-filter-type="${escapeHtml(a.type.toLowerCase())}">
          <div class="annonce-card-meta">
            <span class="badge badge-info">${escapeHtml(a.type)}</span>
            <span>${escapeHtml(a.dateAnnonce)}</span>
          </div>
          <h2 class="annonce-card-title">${escapeHtml(a.titre)}</h2>
          <p class="annonce-card-content">${escapeHtml(a.contenu)}</p>
        </article>`
      )
      .join('');
  }

  window.missaUI?.applyFilters?.();
}

export async function signInWithGoogle(redirectAfter = false): Promise<void> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await ensureUserProfile(result.user);

  await fetch('/page/firebase-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid: result.user.uid,
      nom_complet: result.user.displayName || result.user.email || 'Fidèle',
      email: result.user.email || '',
      paroisse: 'Sainte Rita',
    }),
  });

  if (redirectAfter) {
    window.location.href = '/page/tableau_bords';
  }
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
  stopListeners();
  liveMesses = [];
  liveAnnonces = [];
  liveIntentions = [];
  renderActiveDashboardElements();
}

export async function createIntention(
  messeId: string,
  objetIntention: string,
  detailIntention: string
): Promise<void> {
  if (!currentUser) {
    throw new Error('Veuillez vous connecter avec Google pour soumettre une intention.');
  }
  const messe = liveMesses.find((m) => m.id === messeId);
  if (!messe || !VALID_ID_REGEX.test(messe.id)) {
    throw new Error('Veuillez sélectionner une messe valide.');
  }

  const objet = sanitizeText(objetIntention, 150);
  const detail = sanitizeText(detailIntention, 1000);
  if (!objet || !detail) {
    throw new Error("L'objet et le détail de l'intention sont obligatoires.");
  }

  const id = makeSafeId('int');
  const path = `intentions/${id}`;
  try {
    await setDoc(doc(db, 'intentions', id), {
      fideleId: currentUser.uid,
      fideleNom: sanitizeText(currentUser.displayName || currentUser.email || 'Fidèle', 120),
      messeId: messe.id,
      messeDate: sanitizeText(messe.date, 40),
      messeHoraire: sanitizeText(messe.horaire, 40),
      celebrant: sanitizeText(messe.celebrant, 120),
      objetIntention: objet,
      detailIntention: detail,
      statut: 'en attente',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateIntentionStatus(
  intentionId: string,
  statut: 'validé' | 'annulée'
): Promise<void> {
  if (!currentUser || !isAdminUser(currentUser)) return;
  const path = `intentions/${intentionId}`;
  try {
    await updateDoc(doc(db, 'intentions', intentionId), {
      statut,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function editIntentionDetails(
  intentionId: string,
  objetIntention: string,
  detailIntention: string
): Promise<void> {
  if (!currentUser) return;
  const objet = sanitizeText(objetIntention, 150);
  const detail = sanitizeText(detailIntention, 1000);
  if (!objet || !detail) return;
  const path = `intentions/${intentionId}`;
  try {
    await updateDoc(doc(db, 'intentions', intentionId), {
      objetIntention: objet,
      detailIntention: detail,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeIntention(intentionId: string): Promise<void> {
  if (!currentUser) return;
  const path = `intentions/${intentionId}`;
  try {
    await deleteDoc(doc(db, 'intentions', intentionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createMesseFirestore(
  celebrant: string,
  date: string,
  horaire: string
): Promise<void> {
  if (!currentUser || !isAdminUser(currentUser)) return;
  const id = makeSafeId('messe');
  const path = `messes/${id}`;
  try {
    await setDoc(doc(db, 'messes', id), {
      date: sanitizeText(date, 40),
      horaire: sanitizeText(horaire, 40),
      celebrant: sanitizeText(celebrant, 120),
      paroisse: 'Sainte Rita',
      statut: 'A venir',
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createAnnonceFirestore(
  type: 'evenement' | 'Deces' | 'Communique' | 'Solennite',
  titre: string,
  dateAnnonce: string,
  contenu: string
): Promise<void> {
  if (!currentUser || !isAdminUser(currentUser)) return;
  const id = makeSafeId('annonce');
  const path = `annonces/${id}`;
  try {
    await setDoc(doc(db, 'annonces', id), {
      type,
      titre: sanitizeText(titre, 200),
      dateAnnonce: sanitizeText(dateAnnonce, 40),
      contenu: sanitizeText(contenu, 2000),
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    void ensureUserProfile(user).then(() => {
      startListeners(user);
      renderActiveDashboardElements();
    });
  } else {
    stopListeners();
    liveMesses = [];
    liveAnnonces = [];
    liveIntentions = [];
    renderActiveDashboardElements();
  }
});

let pendingDeleteIntentionId: string | null = null;
let lastFocusedBeforeModal: HTMLElement | null = null;

function closeConfirmDialog(): void {
  pendingDeleteIntentionId = null;
  const dialog = document.getElementById('confirm-dialog');
  const wasOpen = Boolean(dialog && !dialog.classList.contains('hidden'));
  if (dialog) dialog.classList.add('hidden');
  if (wasOpen && lastFocusedBeforeModal && lastFocusedBeforeModal.isConnected) {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

function openDeleteConfirmDialog(intentionId: string): void {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) {
    void removeIntention(intentionId);
    return;
  }
  lastFocusedBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pendingDeleteIntentionId = intentionId;
  dialog.classList.remove('hidden');
  const confirmBtn = document.getElementById('confirm-dialog-confirm') as HTMLButtonElement | null;
  confirmBtn?.focus();
}

// Wire DOM events via delegation so AJAX partial reloads work seamlessly
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (target.id === 'confirm-dialog' || target.id === 'confirm-dialog-cancel') {
    closeConfirmDialog();
    return;
  }

  if (target.id === 'confirm-dialog-confirm') {
    const idToDelete = pendingDeleteIntentionId;
    closeConfirmDialog();
    if (idToDelete) {
      void removeIntention(idToDelete);
    }
    return;
  }

  if (target.id === 'google-signin-btn') {
    const btn = target as HTMLButtonElement;
    const originalText = btn.textContent || 'Continuer avec Google (Firebase)';
    const errBox = document.getElementById('firebase-login-error');
    if (errBox) {
      errBox.classList.add('hidden');
      errBox.textContent = '';
    }
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Connexion en cours...';

    void signInWithGoogle(true)
      .catch((err) => {
        if (errBox) {
          errBox.textContent = err instanceof Error ? err.message : 'Erreur de connexion Google';
          errBox.classList.remove('hidden');
        }
      })
      .finally(() => {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = originalText;
      });
    return;
  }

  if (target.id === 'firebase-auth-action') {
    if (currentUser) {
      void signOutFirebase();
    } else {
      void signInWithGoogle(false);
    }
    return;
  }

  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  const action = actionEl?.getAttribute('data-action');
  const id = actionEl?.getAttribute('data-id');
  if (!action || !id) return;

  if (action === 'validate-intention') {
    void updateIntentionStatus(id, 'validé');
  } else if (action === 'cancel-intention') {
    void updateIntentionStatus(id, 'annulée');
  } else if (action === 'delete-intention') {
    openDeleteConfirmDialog(id);
  } else if (action === 'edit-intention') {
    const existingItem = liveIntentions.find((i) => i.id === id);
    const editForm = document.getElementById('intention-edit-form') as HTMLFormElement | null;
    const editIdInput = document.getElementById('edit-intention-id') as HTMLInputElement | null;
    const editObjetInput = document.getElementById('edit-intention-objet') as HTMLInputElement | null;
    const editDetailInput = document.getElementById('edit-intention-detail') as HTMLTextAreaElement | null;
    if (existingItem && editForm && editIdInput && editObjetInput && editDetailInput) {
      editIdInput.value = existingItem.id;
      editObjetInput.value = existingItem.objetIntention;
      editDetailInput.value = existingItem.detailIntention;
      editForm.classList.remove('hidden');
      editObjetInput.focus();
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeConfirmDialog();
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement | null;
  if (!form) return;

  if (form.id === 'firebase-intention-form') {
    event.preventDefault();
    const messeId = (document.getElementById('intention-messe-select') as HTMLSelectElement | null)?.value || '';
    const objet = (document.getElementById('intention-objet-input') as HTMLInputElement | null)?.value || '';
    const detail = (document.getElementById('intention-detail-input') as HTMLTextAreaElement | null)?.value || '';
    const msgEl = document.getElementById('intention-form-feedback');

    void createIntention(messeId, objet, detail)
      .then(() => {
        form.reset();
        if (msgEl) {
          msgEl.textContent = 'Intention enregistrée dans Firestore (en attente de validation).';
          msgEl.className = 'alert alert-success';
        }
      })
      .catch((err) => {
        if (msgEl) {
          msgEl.textContent = err instanceof Error ? err.message : "Erreur lors de l'envoi.";
          msgEl.className = 'alert alert-error';
        }
      });
  } else if (form.id === 'intention-edit-form') {
    event.preventDefault();
    const id = (document.getElementById('edit-intention-id') as HTMLInputElement | null)?.value || '';
    const objet = (document.getElementById('edit-intention-objet') as HTMLInputElement | null)?.value || '';
    const detail = (document.getElementById('edit-intention-detail') as HTMLTextAreaElement | null)?.value || '';
    void editIntentionDetails(id, objet, detail).then(() => {
      form.classList.add('hidden');
    });
  }
});

declare global {
  interface Window {
    missaFirebase?: {
      refreshCurrentView: () => void;
      signInWithGoogle: typeof signInWithGoogle;
      signOutFirebase: typeof signOutFirebase;
      createMesseFirestore: typeof createMesseFirestore;
      createAnnonceFirestore: typeof createAnnonceFirestore;
    };
    missaUI?: {
      applyFilters: () => void;
    };
  }
}

window.missaFirebase = {
  refreshCurrentView: renderActiveDashboardElements,
  signInWithGoogle,
  signOutFirebase,
  createMesseFirestore,
  createAnnonceFirestore,
};
