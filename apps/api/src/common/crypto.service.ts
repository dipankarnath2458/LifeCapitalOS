import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Field-level encryption for PII at rest using AES-256-GCM. Stored format is
 * `iv:authTag:ciphertext`, all hex. Keys come from FIELD_ENCRYPTION_KEY (32-byte hex).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.get<string>('encryptionKey')!;
    this.key = Buffer.from(hex, 'hex');
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain == null) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(payload: string | null | undefined): string | null {
    if (payload == null) return null;
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) return payload; // tolerate legacy/plaintext
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Deterministic hash for OTP/refresh-token lookups (not reversible). */
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
