import { ConfigService } from '@nestjs/config';
import { createApp } from './app.factory';

/** Local / long-running entrypoint. Serverless deploys use api/index.ts instead. */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 4000;
  // Bind to 0.0.0.0 so container platforms (Railway, Render, Fly, etc.) can route
  // external traffic to the process. Binding to localhost makes the app unreachable
  // from the platform's edge ("Application failed to respond").
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Life Capital OS API running on port ${port} (prefix /api, docs at /api/docs)`);
}

void bootstrap();
