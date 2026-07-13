import { Module } from '@nestjs/common';
import { FirmsController } from './firms.controller';
import { FirmsService } from './firms.service';
import { FirmContextGuard } from './firm-context.guard';

@Module({
  controllers: [FirmsController],
  providers: [FirmsService, FirmContextGuard],
  exports: [FirmsService, FirmContextGuard],
})
export class FirmsModule {}
