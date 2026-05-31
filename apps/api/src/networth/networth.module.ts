import { Module } from '@nestjs/common';
import { NetWorthService } from './networth.service';
import { NetWorthController } from './networth.controller';

@Module({
  controllers: [NetWorthController],
  providers: [NetWorthService],
})
export class NetWorthModule {}
