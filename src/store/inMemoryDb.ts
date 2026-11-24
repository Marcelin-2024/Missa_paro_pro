import crypto from 'crypto';
import type { EcclesiasticalRegistration } from '../modules/ecclesiastical/ecclesiastical.types.js';

export interface UserRecord {
  uid: string;
  role: 'paroisse' | 'fidele';
  nom_complet: string;
  email: string;
  password: string;
  telephone: string;
  diocese: string;
  paroisse: string;
  ecclesiastical?: EcclesiasticalRegistration;
  poste?: string;
  created_at: string;
  push_token?: string;
}

export interface ParoisseRecord {
  id: number;
  nom: string;
  diocese: string;
  ecclesiastical?: EcclesiasticalRegistration;
  nom_complet: string;
  poste: string;
  telephone: string;
  email: string;
}

export interface MesseRecord {
  id: number;
  date: string;
  horaire: string;
  celebrant: string;
  statut: 'A venir' | 'Passée' | 'Annulée';
}

export interface AnnonceRecord {
  id: number;
  type: string;
  titre: string;
  date_annonce: string;
  contenu: string;
  image_url?: string;
  created_at: string;
}

export interface IntentionRecord {
  id: number;
  fidele_id: string | number;
  messe_id: string | number;
  date: string;
  horaire: string;
  celebrant: string;
  objet_intention: string;
  detail_intention: string;
  statut: 'en attente' | 'validé' | 'A venir' | 'Passée' | 'Annulée';
  created_at: string;
}

export interface AvisRecord {
  id: number;
  uid?: string;
  note: number;
  commentaire: string;
  timestamp: string;
}

export interface ContactRecord {
  id: number;
  message: string;
  created_at: string;
}

function nowFormatted(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${pad(d.getMonth() + 1)} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// MOCKED in-memory stores replacing Firebase Auth, Firestore, and Supabase
export const users = new Map<string, UserRecord>();
export const paroisses = new Map<number, ParoisseRecord>();
export const pushTokens = new Map<string, string>();
export const avisList: AvisRecord[] = [];
export const contactList: ContactRecord[] = [];

export const messesList: MesseRecord[] = [
  {
    id: 1,
    date: '14 Décembre 2025',
    horaire: '10h-12H',
    celebrant: 'Père Francois',
    statut: 'A venir',
  },
  {
    id: 2,
    date: '14 Décembre 2025',
    horaire: '10h-12H',
    celebrant: 'Père Francois',
    statut: 'Passée',
  },
  {
    id: 3,
    date: '14 Décembre 2025',
    horaire: '10h-12H',
    celebrant: 'Père Francois',
    statut: 'Annulée',
  },
];

export const annoncesList: AnnonceRecord[] = [
  {
    id: 1,
    type: 'Solennite',
    titre: 'Veillée de prière paroissiale',
    date_annonce: '2025-12-20',
    contenu: 'Tous les fidèles sont conviés à la grande veillée de prière à 19h00.',
    created_at: '10 12 2025 09:00',
  },
  {
    id: 2,
    type: 'Communique',
    titre: 'Catéchèse des jeunes',
    date_annonce: '2025-12-21',
    contenu: 'Les inscriptions pour la catéchèse se poursuivent au secrétariat.',
    created_at: '09 12 2025 14:30',
  },
];

export const intentionsList: IntentionRecord[] = [
  {
    id: 1,
    fidele_id: 'fidele-demo-1',
    messe_id: 1,
    date: '12/12/2025',
    horaire: '10H-12H',
    celebrant: 'Henri du bois',
    objet_intention: 'Action de grâce',
    detail_intention: 'Pour les bienfaits reçus durant cette année',
    statut: 'A venir',
    created_at: '10 12 2025 08:00',
  },
  {
    id: 2,
    fidele_id: 'fidele-demo-1',
    messe_id: 2,
    date: '13/12/2025',
    horaire: '08H-10H',
    celebrant: 'Père Martin',
    objet_intention: 'Repos de l’âme',
    detail_intention: 'En mémoire des défunts de la famille',
    statut: 'Passée',
    created_at: '11 12 2025 10:15',
  },
  {
    id: 3,
    fidele_id: 'fidele-demo-2',
    messe_id: 3,
    date: '14 Décembre 2025',
    horaire: '10h-12H',
    celebrant: 'Père Francois',
    objet_intention: 'Guérison',
    detail_intention: 'Pour les malades de la paroisse',
    statut: 'Annulée',
    created_at: '12 12 2025 11:00',
  },
];

// Seed default paroisse & demo user
paroisses.set(1, {
  id: 1,
  nom: 'Paroisse Sainte Rita',
  diocese: 'Abidjan',
  nom_complet: 'Marcelin Attes',
  poste: 'cure',
  telephone: '+225 0700000000',
  email: 'marcelin@missaparo.com',
});

users.set('marcelin@missaparo.com', {
  uid: 'uid-paroisse-demo-1',
  role: 'paroisse',
  nom_complet: 'Marcelin Attes',
  email: 'marcelin@missaparo.com',
  password: 'password123',
  telephone: '+225 0700000000',
  diocese: 'Abidjan',
  paroisse: 'Sainte Rita',
  poste: 'cure',
  created_at: nowFormatted(),
});

let nextParoisseId = 2;
let nextMesseId = 4;
let nextAnnonceId = 3;
let nextIntentionId = 4;
let nextAvisId = 1;
let nextContactId = 1;

export function registerParoisse(params: {
  nom_complet: string;
  diocese: string;
  paroisse: string;
  ecclesiastical?: EcclesiasticalRegistration;
  email: string;
  poste: string;
  password: string;
  telephone: string;
}): UserRecord {
  const uid = `uid-${crypto.randomUUID().slice(0, 12)}`;
  const user: UserRecord = {
    uid,
    role: 'paroisse',
    nom_complet: params.nom_complet,
    email: params.email,
    password: params.password,
    telephone: params.telephone,
    diocese: params.diocese,
    paroisse: params.paroisse,
    ecclesiastical: params.ecclesiastical,
    poste: params.poste,
    created_at: nowFormatted(),
  };
  users.set(params.email.toLowerCase(), user);

  const paroisseId = nextParoisseId++;
  paroisses.set(paroisseId, {
    id: paroisseId,
    nom: params.paroisse,
    diocese: params.diocese,
    ecclesiastical: params.ecclesiastical,
    nom_complet: params.nom_complet,
    poste: params.poste,
    telephone: params.telephone,
    email: params.email,
  });

  return user;
}

export function registerFidele(params: {
  nom_complet: string;
  diocese: string;
  paroisse: string;
  ecclesiastical?: EcclesiasticalRegistration;
  email: string;
  password: string;
  telephone: string;
}): UserRecord {
  const uid = `uid-${crypto.randomUUID().slice(0, 12)}`;
  const user: UserRecord = {
    uid,
    role: 'fidele',
    nom_complet: params.nom_complet,
    email: params.email,
    password: params.password,
    telephone: params.telephone,
    diocese: params.diocese,
    paroisse: params.paroisse,
    ecclesiastical: params.ecclesiastical,
    created_at: nowFormatted(),
  };
  users.set(params.email.toLowerCase(), user);
  return user;
}

export function authenticateUser(email: string, password: string):
  | { status: 'success'; email: string; uid: string; idToken: string; user: UserRecord }
  | { status: 'error'; message: string } {
  const key = (email || '').trim().toLowerCase();
  const user = users.get(key);
  if (!user) {
    return { status: 'error', message: 'EMAIL_NOT_FOUND' };
  }
  if (user.password !== password) {
    return { status: 'error', message: 'INVALID_PASSWORD' };
  }
  return {
    status: 'success',
    email: user.email,
    uid: user.uid,
    idToken: `mock-token-${crypto.randomBytes(12).toString('hex')}`,
    user,
  };
}

export function addMesse(celebrant: string, date: string, horaire: string): MesseRecord {
  const record: MesseRecord = {
    id: nextMesseId++,
    date: date || 'Date à définir',
    horaire: horaire || '08H-10H',
    celebrant: celebrant || 'Célébrant',
    statut: 'A venir',
  };
  messesList.unshift(record);
  return record;
}

export function addAnnonce(params: {
  type: string;
  titre: string;
  date_annonce: string;
  contenu: string;
  image_url?: string;
}): AnnonceRecord {
  const record: AnnonceRecord = {
    id: nextAnnonceId++,
    type: params.type,
    titre: params.titre,
    date_annonce: params.date_annonce,
    contenu: params.contenu,
    image_url: params.image_url,
    created_at: nowFormatted(),
  };
  annoncesList.unshift(record);
  return record;
}

export function addIntention(params: {
  fidele_id: string | number;
  messe_id: string | number;
  objet_intention: string;
  detail_intention: string;
}): IntentionRecord {
  const record: IntentionRecord = {
    id: nextIntentionId++,
    fidele_id: params.fidele_id,
    messe_id: params.messe_id,
    date: new Date().toLocaleDateString('fr-FR'),
    horaire: '10H-12H',
    celebrant: 'Père Francois',
    objet_intention: params.objet_intention,
    detail_intention: params.detail_intention,
    statut: 'en attente',
    created_at: nowFormatted(),
  };
  intentionsList.unshift(record);
  return record;
}

export function updateIntention(id: number, detail_intention: string, objet_intention: string): IntentionRecord | null {
  const found = intentionsList.find((item) => item.id === id);
  if (!found) return null;
  if (detail_intention) found.detail_intention = detail_intention;
  if (objet_intention) found.objet_intention = objet_intention;
  return found;
}

export function deleteIntention(id: number): boolean {
  const idx = intentionsList.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  intentionsList.splice(idx, 1);
  return true;
}

export function addAvis(uid: string | undefined, note: number, commentaire: string): AvisRecord {
  const rec: AvisRecord = {
    id: nextAvisId++,
    uid,
    note,
    commentaire,
    timestamp: new Date().toISOString(),
  };
  avisList.push(rec);
  return rec;
}

export function addContact(message: string): ContactRecord {
  const rec: ContactRecord = {
    id: nextContactId++,
    message,
    created_at: new Date().toISOString(),
  };
  contactList.push(rec);
  return rec;
}

export function getDashboardStats() {
  const pendingCount = 13 + intentionsList.filter((i) => i.statut === 'en attente').length;
  const validatedCount = 88 + intentionsList.filter((i) => i.statut === 'validé').length;
  const messesCount = messesList.filter((m) => m.statut === 'A venir').length + 1;
  const annoncesCount = 3 + annoncesList.length;

  return {
    pendingCount,
    validatedCount,
    messesCount,
    annoncesCount,
    weeklyTotal: pendingCount + validatedCount,
    recentIntentions: intentionsList.slice(0, 5),
    allIntentions: intentionsList,
    allMesses: messesList,
    allAnnonces: annoncesList,
  };
}
