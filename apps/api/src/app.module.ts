import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { FirmsModule } from './firms/firms.module';
import { HouseholdsModule } from './households/households.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DebtsModule } from './debts/debts.module';
import { GoalsModule } from './goals/goals.module';
import { FamilyModule } from './family/family.module';
import { InsightsModule } from './insights/insights.module';
import { NetWorthModule } from './networth/networth.module';
import { ToolsModule } from './tools/tools.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AaModule } from './aa/aa.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    FirmsModule,
    HouseholdsModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    DebtsModule,
    GoalsModule,
    FamilyModule,
    InsightsModule,
    NetWorthModule,
    ToolsModule,
    BillingModule,
    AdminModule,
    AiModule,
    AaModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
