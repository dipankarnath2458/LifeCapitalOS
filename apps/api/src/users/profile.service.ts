import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { UpdateProfileDto } from '../auth/dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return { ...profile, fullName: this.crypto.decrypt(profile.fullName) };
  }

  async upsert(userId: string, dto: UpdateProfileDto) {
    const data = {
      ...(dto.fullName !== undefined ? { fullName: this.crypto.encrypt(dto.fullName)! } : {}),
      ...(dto.dateOfBirth !== undefined ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
      ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
      ...(dto.annualIncomeMinor !== undefined
        ? { annualIncomeMinor: BigInt(dto.annualIncomeMinor) }
        : {}),
      ...(dto.monthlyExpensesMinor !== undefined
        ? { monthlyExpensesMinor: BigInt(dto.monthlyExpensesMinor) }
        : {}),
      ...(dto.riskTolerance !== undefined ? { riskTolerance: dto.riskTolerance } : {}),
      ...(dto.dependents !== undefined ? { dependents: dto.dependents } : {}),
      ...(dto.hasTermCover !== undefined ? { hasTermCover: dto.hasTermCover } : {}),
      ...(dto.hasHealthInsurance !== undefined
        ? { hasHealthInsurance: dto.hasHealthInsurance }
        : {}),
      ...(dto.termLifeCoverMinor !== undefined
        ? { termLifeCoverMinor: BigInt(dto.termLifeCoverMinor) }
        : {}),
    };
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, fullName: this.crypto.encrypt(dto.fullName ?? '')!, ...data },
      update: data,
    });
    return { ...profile, fullName: this.crypto.decrypt(profile.fullName) };
  }
}
