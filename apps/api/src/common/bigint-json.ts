/**
 * Makes `BigInt` JSON-serializable process-wide.
 *
 * Money is stored in BigInt minor units, so almost every response carries one and
 * `JSON.stringify` would otherwise throw "Do not know how to serialize a BigInt" — a 500 on
 * an endpoint that is otherwise working.
 *
 * This lived as an unnamed side effect inside `app.factory.ts`, which meant it applied only
 * to code paths that happened to import that file. Anything constructing the app another
 * way (the e2e specs do, via `Test.createTestingModule`) silently lost it. Importing this
 * module for its side effect makes the dependency explicit and greppable.
 */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

export {};
