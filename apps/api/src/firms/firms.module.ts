import { Module } from '@nestjs/common';
import { FirmsController } from './firms.controller';
import { FirmsService } from './firms.service';
import { FirmContextGuard } from './firm-context.guard';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [FirmsController, MembersController],
  providers: [FirmsService, MembersService, FirmContextGuard],
  exports: [FirmsService, FirmContextGuard],
})
export class FirmsModule {}
