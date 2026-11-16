import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './config/logger';
import apiRouter from './routes/index';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';


export function createApp(): Application {
  const app = express();

  // ── Proxys de confiance ────────────────────────────────────────────────────
  // Sans ça, derrière Caddy toutes les requêtes portent l'IP du proxy : le rate
  // limiting devient global (un seul visiteur peut bloquer tout le monde).
  const trustProxy = env.TRUST_PROXY ?? (env.NODE_ENV === 'production' ? 2 : 0);
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  // ── Sécurité ───────────────────────────────────────────────────────────────
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Pour les assets GLTF
  }));

  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Rate limiting global (plus permissif en dev)
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: env.NODE_ENV === 'production' ? 100 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de requêtes, réessayez plus tard.' },
  }));

  // ── Parsing ────────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' })); // 10mb pour les payloads GLTF / images base64
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // ── Logging HTTP ───────────────────────────────────────────────────────────
  app.use(morgan(
    env.NODE_ENV === 'production' ? 'combined' : 'dev',
    { stream: { write: (msg) => logger.http(msg.trim()) } },
  ));

  // ── Routes API ─────────────────────────────────────────────────────────────
  app.use('/api', apiRouter);

  // ── 404 + Error handlers (doivent être en dernier) ─────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}