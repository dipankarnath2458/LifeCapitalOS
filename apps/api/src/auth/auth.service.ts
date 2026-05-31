import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ---- OTP (primary for India phone-first onboarding) ----

  async requestOtp(channel: 'phone' | 'email', target: string): Promise<{ sent: true; devCode?: string }> {
    const code = randomInt(100000, 999999).toString();
    await this.prisma.otpCode.create({
      data: {
        channel,
        target,
        codeHash: this.crypto.hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    // In production this dispatches via SMS/email provider. In sandbox we return it.
    const sandbox = this.config.get<string>('nodeEnv') !== 'production';
    return sandbox ? { sent: true, devCode: code } : { sent: true };
  }

  async verifyOtp(channel: 'phone' | 'email', target: string, code: string): Promise<TokenPair> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { target, channel, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('OTP expired or not found');
    if (otp.attempts >= MAX_OTP_ATTEMPTS) throw new BadRequestException('Too many attempts');

    if (otp.codeHash !== this.crypto.hash(code)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid code');
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const user = await this.upsertUserByChannel(channel, target);
    return this.issueTokens(user.id, user.role);
  }

  private async upsertUserByChannel(channel: 'phone' | 'email', target: string) {
    const where = channel === 'phone' ? { phone: target } : { email: target };
    const existing = await this.prisma.user.findUnique({ where });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastLoginAt: new Date(), ...(channel === 'phone' ? { phoneVerified: true } : { emailVerified: true }) },
      });
      return existing;
    }
    const created = await this.prisma.user.create({
      data: {
        ...(channel === 'phone' ? { phone: target, phoneVerified: true } : { email: target, emailVerified: true }),
        lastLoginAt: new Date(),
      },
    });
    await this.audit.log({ actorId: created.id, action: 'user.register', entityType: 'User', entityId: created.id });
    return created;
  }

  // ---- Email + password ----

  async register(email: string, password: string, fullName: string): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Email already registered');
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        emailVerified: false,
        profile: { create: { fullName: this.crypto.encrypt(fullName)! } },
      },
    });
    await this.audit.log({ actorId: user.id, action: 'user.register', entityType: 'User', entityId: user.id });
    return this.issueTokens(user.id, user.role);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'active') throw new UnauthorizedException('Account is not active');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.role);
  }

  // ---- Tokens ----

  private async issueTokens(userId: string, role: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessTtl'),
      },
    );
    const refreshRaw = randomBytes(48).toString('hex');
    const days = this.config.get<number>('jwt.refreshTtlDays')!;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.crypto.hash(refreshRaw),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken: refreshRaw };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = this.crypto.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Rotate: revoke the old token, issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('User not active');
    return this.issueTokens(user.id, user.role);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.crypto.hash(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
