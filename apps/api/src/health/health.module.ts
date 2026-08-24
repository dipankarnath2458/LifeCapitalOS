import { Controller, Get, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Liveness plus build identity.
   *
   * `status: 'ok'` is NOT a claim that the deployment works — this endpoint answers 200 with
   * `db: 'down'`, which is the honest report and the reason `scripts/verify-deployment.mjs`
   * exists. `commit` was added because nothing else the deployment exposes names its own
   * build: Swagger is off in production, so confirming that merged code was live meant
   * inferring it from an auth-status discriminator. `null` means the platform supplied no
   * commit SHA, which is a different fact from "some build is running" and is reported as
   * such rather than guessed.
   */
  @Public()
  @Get()
  async check() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: 'ok',
      db,
      commit: this.config.get<string | null>('build.commit') ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
