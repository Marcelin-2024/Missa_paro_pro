import 'dotenv/config';
import path from 'path';
import express, { Request, Response } from 'express';
import session from 'express-session';
import { pageRouter } from './src/routes/pageRoutes.js';
import { refreshRouter } from './src/routes/refreshRoutes.js';
import { apiRouter } from './src/routes/apiRoutes.js';
import { ecclesiasticalRouter } from './src/modules/ecclesiastical/ecclesiastical.routes.js';
import { loadFormConfig } from './src/utils/formConfig.js';

declare module 'express-session' {
  interface SessionData {
    uid?: string;
    user?: {
      uid: string;
      nom_complet: string;
      paroisse: string;
      email: string;
    };
  }
}

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use('/static', express.static(path.join(process.cwd(), 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'test_J7kL9mN2bV4cX6zB8nM1qW3eR5tY7',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

app.use('/page', pageRouter);
app.use('/refresh', refreshRouter);
app.use('/api/ecclesiastical', ecclesiasticalRouter);
app.use('/api', apiRouter);

app.get('/', (_req: Request, res: Response) => {
  const formData = loadFormConfig();
  res.render('compte', { champs: formData.connection, error: null });
});

app.get('/login', (_req: Request, res: Response) => {
  res.render('login');
});

app.listen(PORT, HOST, () => {
  console.log(`Missa Paro server listening on http://${HOST}:${PORT}`);
});
