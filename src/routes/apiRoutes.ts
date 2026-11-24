import { Router, Request, Response } from 'express';
import { validateEcclesiasticalRegistration } from '../modules/ecclesiastical/ecclesiastical.service.js';
import {
  addAvis,
  addContact,
  addIntention,
  annoncesList,
  authenticateUser,
  deleteIntention,
  intentionsList,
  messesList,
  paroisses,
  pushTokens,
  registerFidele,
  updateIntention,
} from '../store/inMemoryDb.js';

export const apiRouter = Router();

apiRouter.post('/fideles', (req: Request, res: Response) => {
  const data = req.body as Record<string, string> | undefined;
  if (data && Object.keys(data).length > 0) {
    const nom = data.nom ?? '';
    const prenoms = data.prenoms ?? '';
    const email = data.email ?? '';
    const password = data.password ?? '';
    const telephone = data.telephone ?? '';
    let diocese = data.diocese ?? '';
    let paroisse = data.paroisse ?? '';
    let ecclesiastical;
    const nom_complet = `${nom} ${prenoms}`.trim();

    if (data.provinceId || data.dioceseId || data.parishId || data.missingParishName) {
      const validation = validateEcclesiasticalRegistration({
        provinceId: data.provinceId,
        dioceseId: data.dioceseId,
        parishId: data.parishId,
        missingParishName: data.missingParishName,
        parishRequestId: data.parishRequestId,
      });

      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: validation.error,
        });
        return;
      }

      diocese = validation.diocese.name;
      paroisse = validation.registration.parishNameSnapshot ?? '';
      ecclesiastical = validation.registration;
    }

    registerFidele({
      nom_complet,
      diocese,
      paroisse,
      ecclesiastical,
      email,
      password,
      telephone,
    });

    res.status(201).json({ success: true, data: 'donnée envoyée', ecclesiastical });
    return;
  }

  res.status(400).json({
    success: false,
    data: 'mauvais envoie du fichier json',
  });
});

apiRouter.post('/login', (req: Request, res: Response) => {
  const { email = '', password = '' } = (req.body ?? {}) as Record<string, string>;
  const resultat = authenticateUser(email, password);
  if (resultat.status === 'success') {
    req.session.uid = resultat.uid;
    res.status(200).json({
      status: resultat.status,
      email: resultat.email,
      uid: resultat.uid,
      idToken: resultat.idToken,
    });
    return;
  }
  res.status(401).json(resultat);
});

apiRouter.get('/paroisse/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const paroisse = paroisses.get(id);
  if (!paroisse) {
    res.status(404).json({ error: 'Paroisse introuvable' });
    return;
  }
  res.json(paroisse);
});

apiRouter.get('/messes', (_req: Request, res: Response) => {
  res.json(messesList);
});

apiRouter.get('/annonces', (_req: Request, res: Response) => {
  res.json(annoncesList);
});

apiRouter.post('/intentions', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | undefined;
  const payload = (body && typeof body.data === 'object' && body.data !== null
    ? body.data
    : body) as Record<string, string | number> | undefined;

  if (payload && Object.keys(payload).length > 0) {
    addIntention({
      fidele_id: payload.fidele_id ?? '',
      messe_id: payload.messe_id ?? '',
      objet_intention: String(payload.objet_intention ?? payload.type_intention ?? ''),
      detail_intention: String(payload.detail_intention ?? ''),
    });
    res.status(201).json({ success: true, data: 'donnée envoyée' });
    return;
  }

  res.status(400).json({
    success: false,
    data: 'mauvais envoie du fichier json',
  });
});

apiRouter.put('/intentions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { detail_intention = '', objet_intention = '' } = (req.body ?? {}) as Record<string, string>;
  updateIntention(id, detail_intention, objet_intention);
  res.json({ message: `Intention ${id} mise à jour` });
});

apiRouter.delete('/intentions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  deleteIntention(id);
  res.json({ message: `Intention ${id} supprimée` });
});

apiRouter.get('/intentions/mes/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const rows = intentionsList.filter((item) => String(item.fidele_id) === String(id));
  res.json(rows);
});

apiRouter.get('/intentions/mes', (req: Request, res: Response) => {
  const uid = req.session.uid;
  const rows = uid
    ? intentionsList.filter((item) => String(item.fidele_id) === String(uid))
    : intentionsList;
  res.json(rows);
});

apiRouter.get('/intentions/validees', (_req: Request, res: Response) => {
  const rows = intentionsList.filter(
    (item) => item.statut === 'validé' || item.statut === 'A venir'
  );
  res.json(rows);
});

apiRouter.post('/notifications/registerPush', (req: Request, res: Response) => {
  const { token = 'registered' } = (req.body ?? {}) as Record<string, string>;
  const uid = req.session.uid ?? 'anonymous';
  pushTokens.set(uid, token);
  res.json({ status: 'Success', token: 'registered' });
});

apiRouter.post('/contact', (req: Request, res: Response) => {
  const { message = '' } = (req.body ?? {}) as Record<string, string>;
  addContact(message);
  res.json({ message: 'Message de contact bien reçu' });
});

apiRouter.post('/avis', (req: Request, res: Response) => {
  const { note = 5, commentaire = '' } = (req.body ?? {}) as Record<string, unknown>;
  addAvis(req.session.uid, Number(note), String(commentaire));
  res.json({ message: 'Merci pour votre note !' });
});
