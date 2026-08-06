import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EMAIL_TRANSPORT, type EmailTransport } from './transports/email.transport';
import { ConsoleEmailTransport } from './transports/console.transport';
import { ResendEmailTransport } from './transports/resend.transport';

/**
 * Wires the configured transport. `provider` is derived from whether an API key exists
 * (see `configuration.ts`), so this cannot select a provider it has no credentials for.
 *
 * Global so any feature module can inject {@link EmailService} without re-importing —
 * the same pattern as CommonModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailTransport => {
        const logger = new Logger('EmailModule');
        const provider = config.get<string>('email.provider');

        if (provider === 'resend') {
          const from = config.get<string>('email.from')!;
          logger.log(`Email transport: resend (from: ${from})`);
          return new ResendEmailTransport(config.get<string>('email.apiKey')!, from);
        }

        // No provider configured. Fine locally; in production it means password-reset and
        // verification emails are being written to the log instead of anyone's inbox, so
        // say so at boot rather than letting it be discovered by a stuck user.
        const message =
          'No email provider configured (RESEND_API_KEY is unset) — password reset and ' +
          'verification emails will be LOGGED, not sent.';
        if (config.get<string>('nodeEnv') === 'production') logger.error(message);
        else logger.warn(message);
        return new ConsoleEmailTransport();
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
