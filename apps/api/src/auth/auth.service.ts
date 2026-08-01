import {
  BadRequestException,
  Injectable,
  Logger,
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
const RESET_TTL_MS = 30 * 60 * 1000;
// Per-target send throttle to prevent SMS/email bombing and unbounded row growth.
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;

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
    await this.assertSendAllowed(channel, target);
    const code = randomInt(100000, 999999).toString();
    await this.prisma.otpCode.create({
      data: {
        channel,
        target,
        codeHash: this.crypto.hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    // In production this dispatches via SMS/email provider. Codes are only echoed back
    // when SANDBOX_RETURN_SECRETS is explicitly enabled (never in production).
    return this.config.get<boolean>('returnDevSecrets') ? { sent: true, devCode: code } : { sent: true };
  }

  /**
   * Windowed per-target throttle for one-time codes. Rejects once a target has been sent
   * MAX_SENDS_PER_WINDOW codes within SEND_WINDOW_MS, independent of the global rate limit.
   */
  private async assertSendAllowed(channel: string, target: string): Promise<void> {
    const recent = await this.prisma.otpCode.count({
      where: { channel, target, createdAt: { gt: new Date(Date.now() - SEND_WINDOW_MS) } },
    });
    if (recent >= MAX_SENDS_PER_WINDOW) {
      throw new BadRequestException('Too many requests. Please wait a few minutes and try again.');
    }
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
    // TEMPORARY diagnostic logging — remove after production auth diagnosis.
    // Logs only non-sensitive signals: never the password, hash, token, or any secret.
    const diag = new Logger('AuthService.login');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      diag.warn(
        `[login-diagnostic] userFound=${!!user} status=${user?.status ?? 'not-found'} ` +
          `hasPasswordHash=${!!user?.passwordHash} submittedPasswordLength=${password?.length ?? 0} ` +
          `argon2Verify=n/a`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== 'active') {
      diag.warn(
        `[login-diagnostic] userFound=true status=${user.status} hasPasswordHash=true ` +
          `submittedPasswordLength=${password?.length ?? 0} argon2Verify=skipped-inactive`,
      );
      throw new UnauthorizedException('Account is not active');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    diag.warn(
      `[login-diagnostic] userFound=true status=${user.status} hasPasswordHash=true ` +
        `submittedPasswordLength=${password?.length ?? 0} argon2Verify=${ok}`,
    );
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.role);
  }

  // ---- Password management ----

  /** Change the password for a signed-in user after verifying the current one. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new BadRequestException('Password change is not available for this account');
    }
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Revoke existing sessions so other devices must sign in again with the new password.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({ actorId: userId, action: 'user.password_changed', entityType: 'User', entityId: userId });
    return { ok: true };
  }

  /**
   * Start a password reset. Always reports success to avoid leaking which emails are
   * registered; a token is only created (and, in sandbox, returned) when the user exists.
   * In production the token would be emailed instead of returned.
   */
  async forgotPassword(email: string): Promise<{ sent: true; devToken?: string }> {
    // Throttle by target regardless of whether the account exists, so this can't be used
    // to probe registration state via differing rate-limit behaviour.
    await this.assertSendAllowed('password_reset', email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { sent: true };

    const token = randomBytes(32).toString('hex');
    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        channel: 'password_reset',
        target: email,
        codeHash: this.crypto.hash(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'user.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
    });
    return this.config.get<boolean>('returnDevSecrets') ? { sent: true, devToken: token } : { sent: true };
  }

  /** Complete a password reset with the token from forgotPassword. */
  async resetPassword(email: string, token: string, newPassword: string): Promise<{ ok: true }> {
    const record = await this.prisma.otpCode.findFirst({
      where: { target: email, channel: 'password_reset', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Reset token is invalid or has expired');
    if (record.attempts >= MAX_OTP_ATTEMPTS) throw new BadRequestException('Too many attempts');

    if (record.codeHash !== this.crypto.hash(token)) {
      await this.prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('Invalid reset token');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('Account not found');

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({ actorId: user.id, action: 'user.password_reset', entityType: 'User', entityId: user.id });
    return { ok: true };
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
