import express, { type Express, type Request, type Response } from 'express';
import serverless from 'serverless-http';
import { createApp } from '../src/app.factory';

/**
 * Vercel serverless entrypoint for the NestJS API. This optional catch-all
 * ([[...path]]) handles every `/api/*` request (the Nest app sets a global `api`
 * prefix). The app is built once per warm container and the Express handler cached.
 */
type Handler = (req: Request, res: Response) => unknown;

let cachedHandler: Handler | null = null;

async function getHandler(): Promise<Handler> {
  if (cachedHandler) return cachedHandler;
  const expressApp: Express = express();
  const app = await createApp(expressApp);
  await app.init();
  cachedHandler = serverless(expressApp) as unknown as Handler;
  return cachedHandler;
}

export default async function handler(req: Request, res: Response) {
  const h = await getHandler();
  return h(req, res);
}
