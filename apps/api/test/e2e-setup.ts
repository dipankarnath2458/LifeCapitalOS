/**
 * Runs before every e2e spec.
 *
 * The specs build the app with `Test.createTestingModule`, which bypasses
 * `app.factory.ts` — and with it the global BigInt→JSON patch that production applies at
 * boot. Without this, any endpoint returning money (BigInt minor units) 500s under test
 * while working fine in production, so the suite could neither reproduce nor catch a real
 * serialization regression.
 */
import '../src/common/bigint-json';
