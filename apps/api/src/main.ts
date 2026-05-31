import { ConfigService } from '@nestjs/config';
import { createApp } from './app.factory';

/** Local / long-running entrypoint. Serverless deploys use api/index.ts instead. */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Life Capital OS API running on http://localhost:${port}/api (docs at /api/docs)`);
}

void bootstrap();
