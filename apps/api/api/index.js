// Vercel serverless entrypoint for the NestJS API.
//
// This file is intentionally plain JavaScript and imports from the COMPILED
// output (../dist), not the TypeScript source. Vercel bundles functions with
// esbuild, which does NOT emit the decorator metadata (`emitDecoratorMetadata`)
// that NestJS dependency injection relies on. `nest build` (tsc) emits that
// metadata into dist/, so importing the compiled app keeps DI working at runtime.
const serverless = require('serverless-http');
const express = require('express');
const { createApp } = require('../dist/app.factory');

let cachedHandler;

async function buildHandler() {
  const expressApp = express();
  const nestApp = await createApp(expressApp);
  await nestApp.init();
  return serverless(expressApp);
}

module.exports = async (req, res) => {
  if (!cachedHandler) cachedHandler = buildHandler();
  const handler = await cachedHandler;
  return handler(req, res);
};
