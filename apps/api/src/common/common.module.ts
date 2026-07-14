import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { AuditService } from './audit.service';
import { FinancialSnapshotService } from './financial-snapshot.service';
import { FxService } from './fx.service';

@Global()
@Module({
  providers: [CryptoService, AuditService, FinancialSnapshotService, FxService],
  exports: [CryptoService, AuditService, FinancialSnapshotService, FxService],
})
export class CommonModule {}
