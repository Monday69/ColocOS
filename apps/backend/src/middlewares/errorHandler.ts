import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { ApiError } from '../types';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error(`${req.method} ${req.path}`, { error: err.message, stack: err.stack });

  // Erreur applicative intentionnelle
  if (err instanceof AppError) {
    const response: ApiError = {
      success: false,
      error: err.message,
      details: err.details,
      statusCode: err.statusCode,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Erreur de validation Zod
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const key = e.path.join('.');
      details[key] = details[key] ?? [];
      details[key].push(e.message);
    });
    res.status(400).json({
      success: false,
      error: 'Données invalides',
      details,
      statusCode: 400,
    } satisfies ApiError);
    return;
  }

  // Erreurs Prisma
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: 'Cette ressource existe déjà (contrainte d\'unicité)',
        statusCode: 409,
      } satisfies ApiError);
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Ressource introuvable',
        statusCode: 404,
      } satisfies ApiError);
      return;
    }
  }

  // Erreur interne non gérée
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur interne du serveur'
      : err.message,
    statusCode: 500,
  } satisfies ApiError);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} introuvable`,
    statusCode: 404,
  } satisfies ApiError);
};