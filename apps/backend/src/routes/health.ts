import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { ApiResponse } from '../types';

const router = Router();

interface HealthData {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error';
    server: 'ok';
  };
}

/**
 * GET /health
 * Vérifie l'état du serveur et de la base de données.
 * Utilisé par Docker healthcheck, load balancer, monitoring.
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  let dbStatus: 'ok' | 'error' = 'error';

  try {
    // Ping rapide BDD
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'ok';
  } catch {
    // La BDD est down — on retourne un 503 mais le serveur répond
  }

  const latency = Date.now() - startTime;
  const isHealthy = dbStatus === 'ok';

  const data: HealthData = {
    status: isHealthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    services: {
      database: dbStatus,
      server: 'ok',
    },
  };

  const response: ApiResponse<HealthData & { latencyMs: number }> = {
    success: isHealthy,
    data: { ...data, latencyMs: latency },
  };

  res.status(isHealthy ? 200 : 503).json(response);
});

export default router;