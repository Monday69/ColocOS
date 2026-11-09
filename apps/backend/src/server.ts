import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { startExpiryCron } from './jobs/expiryCron';

const app = createApp();

// ── Démarrage ──────────────────────────────────────────────────────────────
const server = app.listen(env.PORT, () => {
  logger.info(`
  ╔═══════════════════════════════════════════╗
  ║          ColocOS API — Démarré            ║
  ╠═══════════════════════════════════════════╣
  ║  Port     : ${String(env.PORT).padEnd(28)}║
  ║  Env      : ${env.NODE_ENV.padEnd(28)}║
  ║  Health   : http://localhost:${env.PORT}/api/health  ║
  ╚═══════════════════════════════════════════╝
  `);
});

// ── Tâche planifiée : alerte de péremption J+1 (09:00 Europe/Paris) ────────
const expiryTask = env.NODE_ENV === 'test' ? null : startExpiryCron();

// ── Graceful Shutdown ──────────────────────────────────────────────────────
// Ferme proprement les connexions BDD avant d'arrêter le process
const shutdown = async (signal: string) => {
  logger.info(`Signal ${signal} reçu — arrêt gracieux...`);
  expiryTask?.stop();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Connexion Prisma fermée.');
      process.exit(0);
    } catch (err) {
      logger.error('Erreur lors de la déconnexion Prisma', err);
      process.exit(1);
    }
  });

  // Force kill après 10s si les connexions ne se ferment pas
  setTimeout(() => {
    logger.error('Timeout graceful shutdown — force kill');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Erreurs non gérées — log + arrêt propre
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
  shutdown('uncaughtException');
});