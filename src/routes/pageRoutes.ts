import { Router, Request, Response } from 'express';
import multer from 'multer';
import { loadFormConfig } from '../utils/formConfig.js';
import {
  listProvincesSummary,
  validateEcclesiasticalRegistration,
} from '../modules/ecclesiastical/ecclesiastical.service.js';
import {
  addAnnonce,
  addMesse,
  authenticateUser,
  getDashboardStats,
  registerParoisse,
} from '../store/inMemoryDb.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const pageRouter = Router();

pageRouter.get('/inscription', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  res.render('inscription', {
    champs: formData.inscription_champs,
    provinces: listProvincesSummary(),
    error: null,
  });
});

pageRouter.post('/valide', (req: Request, res: Response) => {
  const {
    provinceId = '',
    dioceseId = '',
    parishId = '',
    missing_parish_name = '',
    parish_request_id = '',
    nom_complet = '',
    poste = '',
    telephone = '',
    gmail = '',
    motdepasse = '',
    confirmationmotdepasse = '',
  } = req.body as Record<string, string>;

  const formData = loadFormConfig();

  if (confirmationmotdepasse && motdepasse !== confirmationmotdepasse) {
    res.status(400).render('inscription', {
      champs: formData.inscription_champs,
      provinces: listProvincesSummary(),
      error: 'Les mots de passe ne correspondent pas.',
    });
    return;
  }

  const validation = validateEcclesiasticalRegistration({
    provinceId,
    dioceseId,
    parishId,
    missingParishName: missing_parish_name,
    parishRequestId: parish_request_id,
  });

  if (!validation.valid) {
    res.status(400).render('inscription', {
      champs: formData.inscription_champs,
      provinces: listProvincesSummary(),
      error: validation.error,
    });
    return;
  }

  registerParoisse({
    nom_complet,
    diocese: validation.diocese.name,
    paroisse: validation.registration.parishNameSnapshot ?? '',
    ecclesiastical: validation.registration,
    email: gmail,
    poste,
    password: motdepasse,
    telephone,
  });

  res.redirect('/');
});

pageRouter.post('/verification', (req: Request, res: Response) => {
  const { gmail = '', motdepasse = '' } = req.body as Record<string, string>;
  const result = authenticateUser(gmail, motdepasse);

  if (result.status === 'success') {
    req.session.uid = result.uid;
    req.session.user = {
      uid: result.uid,
      nom_complet: result.user.nom_complet,
      paroisse: result.user.paroisse,
      email: result.user.email,
    };
    res.render('verification', { reponse: result.uid });
    return;
  }

  const formData = loadFormConfig();
  res.status(401).render('compte', {
    champs: formData.connection,
    error: 'Email ou mot de passe incorrect. (Compte démo : marcelin@missaparo.com / password123)',
  });
});

pageRouter.get('/tableau_bords', (req: Request, res: Response) => {
  const stats = getDashboardStats();
  const user = req.session.user ?? {
    uid: 'uid-paroisse-demo-1',
    nom_complet: 'Marcelin Attes',
    paroisse: 'Sainte Rita',
    email: 'marcelin@missaparo.com',
  };
  res.render('tableau_bords', { user, stats });
});

pageRouter.get('/messes', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  res.render('ajoute_messe', { champs: formData.messes });
});

pageRouter.post('/ajoute_messe', (req: Request, res: Response) => {
  const {
    Celebrant_messe = 'Père Francois',
    date_messe = '',
    heure_messe = '',
  } = req.body as Record<string, string>;

  addMesse(Celebrant_messe, date_messe, heure_messe);
  res.redirect('/page/tableau_bords');
});

pageRouter.get('/annonces', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  res.render('annonces', { champs: formData.annonces });
});

pageRouter.post('/ajoute_annonce', upload.single('image_annonce'), (req: Request, res: Response) => {
  const {
    type_annonces = 'Communique',
    Titre_annonce = '',
    date_annonce = '',
    contenu_annonce = '',
  } = req.body as Record<string, string>;

  let imageUrl: string | undefined;
  if (req.file) {
    imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }

  addAnnonce({
    type: type_annonces,
    titre: Titre_annonce,
    date_annonce,
    contenu: contenu_annonce,
    image_url: imageUrl,
  });

  res.redirect('/page/tableau_bords');
});

pageRouter.post('/firebase-session', (req: Request, res: Response) => {
  const {
    uid = '',
    nom_complet = 'Fidèle',
    paroisse = 'Sainte Rita',
    email = '',
  } = (req.body ?? {}) as Record<string, string>;

  if (!uid) {
    res.status(400).json({ error: 'UID manquant' });
    return;
  }

  req.session.uid = uid;
  req.session.user = {
    uid,
    nom_complet,
    paroisse,
    email,
  };

  res.json({ success: true });
});

pageRouter.get('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});
