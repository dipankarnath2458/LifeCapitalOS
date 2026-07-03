import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators';

/** Shape of an account pulled from an Account Aggregator. */
export interface AaFetchedAccount {
  name: string;
  type: string;
  assetClass: string;
  currency: string;
  balanceMinor: number;
  accountRef: string;
}

/**
 * Deterministic sample accounts used in AA sandbox mode so the end-to-end linking and
 * upsert flow can be exercised without a live Account Aggregator. Mirrors a typical
 * Indian household: a savings account, a broking/equity account and a fixed deposit.
 */
export function sandboxAccounts(): AaFetchedAccount[] {
  return [
    { name: 'HDFC Bank Savings', type: 'bank', assetClass: 'cash', currency: 'INR', balanceMinor: 4_50_000_00, accountRef: 'aa-hdfc-sav-001' },
    { name: 'Zerodha Equity', type: 'investment', assetClass: 'equity', currency: 'INR', balanceMinor: 12_80_000_00, accountRef: 'aa-zerodha-eq-001' },
    { name: 'SBI Fixed Deposit', type: 'investment', assetClass: 'debt', currency: 'INR', balanceMinor: 6_00_000_00, accountRef: 'aa-sbi-fd-001' },
  ];
}

@Injectable()
class AaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  private get provider(): string {
    return this.config.get<string>('aa.provider') ?? 'setu';
  }
  private get sandbox(): boolean {
    return this.config.get<boolean>('aa.sandbox') ?? true;
  }

  /** Account Aggregation is premium and globally flag-gated; require both. */
  private async assertEnabled(userId: string): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: 'aa.enabled' } });
    if (!flag?.enabled) throw new ForbiddenException('Account Aggregation is not enabled.');

    await this.billing.assertFeature(
      userId,
      'account_aggregation',
      'Account Aggregation is a Premium feature. Upgrade to unlock it.',
    );
  }

  /**
   * Start an AA consent. In sandbox the consent is granted immediately; in live mode this
   * is where the provider (Setu) consent-handle + redirect URL would be returned.
   */
  async initiateConsent(userId: string) {
    await this.assertEnabled(userId);
    const consent = await this.prisma.consent.create({
      data: { userId, purpose: 'account_aggregation', granted: this.sandbox },
    });
    await this.audit.log({ actorId: userId, action: 'aa.consent_initiated', entityType: 'consent', entityId: consent.id });
    return {
      provider: this.provider,
      sandbox: this.sandbox,
      consentId: consent.id,
      granted: consent.granted,
      // In live mode the user is redirected to the AA to approve; null in sandbox.
      redirectUrl: this.sandbox ? null : `https://${this.provider}.example/consent/${consent.id}`,
    };
  }

  /** Pull balances from the AA and upsert them as accounts keyed by their AA reference. */
  async sync(userId: string) {
    await this.assertEnabled(userId);
    const consent = await this.prisma.consent.findFirst({
      where: { userId, purpose: 'account_aggregation', granted: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!consent) throw new BadRequestException('Account Aggregator consent is required before syncing.');

    const fetched = this.sandbox ? sandboxAccounts() : await this.fetchFromProvider(consent.id);

    let linked = 0;
    for (const a of fetched) {
      const existing = await this.prisma.account.findFirst({
        where: { userId, aaProvider: this.provider, aaAccountRef: a.accountRef },
      });
      const data = {
        name: a.name,
        type: a.type as never,
        assetClass: a.assetClass as never,
        currency: a.currency,
        balanceMinor: BigInt(a.balanceMinor),
        isLiability: false,
      };
      if (existing) {
        await this.prisma.account.update({ where: { id: existing.id }, data: { balanceMinor: data.balanceMinor } });
      } else {
        await this.prisma.account.create({
          data: { userId, aaProvider: this.provider, aaAccountRef: a.accountRef, ...data },
        });
        linked += 1;
      }
    }
    await this.audit.log({
      actorId: userId,
      action: 'aa.sync',
      entityType: 'user',
      entityId: userId,
      metadata: { fetched: fetched.length, newlyLinked: linked },
    });
    return { provider: this.provider, sandbox: this.sandbox, fetched: fetched.length, newlyLinked: linked };
  }

  async status(userId: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: 'aa.enabled' } });
    const [consent, linkedCount] = await Promise.all([
      this.prisma.consent.findFirst({ where: { userId, purpose: 'account_aggregation', granted: true } }),
      this.prisma.account.count({ where: { userId, aaProvider: this.provider } }),
    ]);
    return {
      enabled: !!flag?.enabled,
      provider: this.provider,
      sandbox: this.sandbox,
      consentGranted: !!consent,
      linkedAccounts: linkedCount,
    };
  }

  /** Live fetch from the AA provider (Setu). Not exercised in sandbox mode. */
  private async fetchFromProvider(_consentId: string): Promise<AaFetchedAccount[]> {
    throw new Error('Live Account Aggregator fetch is not configured.');
  }
}

@ApiTags('account-aggregator')
@Controller('aa')
class AaController {
  constructor(private readonly aa: AaService) {}

  @Post('consent/initiate')
  initiate(@CurrentUser() user: AuthUser) {
    return this.aa.initiateConsent(user.id);
  }

  @Post('sync')
  sync(@CurrentUser() user: AuthUser) {
    return this.aa.sync(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.aa.status(user.id);
  }
}

@Module({
  imports: [BillingModule],
  controllers: [AaController],
  providers: [AaService],
})
export class AaModule {}
