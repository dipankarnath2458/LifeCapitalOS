import { Injectable, Logger } from '@nestjs/common';
import { CurrencyCode, FxRateProvider, StaticFxRateProvider } from '@lcos/core';

/**
 * Supplies FX rates to the domain layer. Implements the `@lcos/core` `FxRateProvider`
 * contract so the finance calculators stay provider-agnostic (ADR-003).
 *
 * Backed by a **static/config** rate table for now: core defaults, optionally
 * overridden by `FX_USD_PER_UNIT` (a JSON map of "USD per 1 unit" values). To move to
 * a live feed later, swap the `provider` construction here (or bind a different
 * `FxRateProvider` in DI) — **no domain code or call site changes.**
 */
@Injectable()
export class FxService implements FxRateProvider {
  private readonly logger = new Logger(FxService.name);
  private readonly provider: FxRateProvider;
  /**
   * Identifier of the rate set in use. Stamped into Financial Snapshots (M2-6) so a
   * conversion is reproducible. `static-v1` is the default table; an override switches
   * it to `static-override` (the config-supplied rates).
   */
  readonly version: string;

  constructor() {
    let overrides: Partial<Record<CurrencyCode, number>> | undefined;
    const raw = process.env.FX_USD_PER_UNIT;
    if (raw) {
      try {
        overrides = JSON.parse(raw) as Partial<Record<CurrencyCode, number>>;
      } catch {
        this.logger.warn('FX_USD_PER_UNIT is not valid JSON; using default rates.');
      }
    }
    this.provider = new StaticFxRateProvider(overrides);
    this.version = overrides ? 'static-override' : 'static-v1';
  }

  rate(from: CurrencyCode, to: CurrencyCode): number {
    return this.provider.rate(from, to);
  }
}
