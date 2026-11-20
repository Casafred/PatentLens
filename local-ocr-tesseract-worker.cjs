"use strict";

/**
 * Node worker for the offline OCR fallback.
 *
 * Tesseract.js normally probes three WASM SIMD variants in the worker.  That
 * is useful for a general purpose package, but it makes the desktop installer
 * carry several copies of the same LSTM core.  PatentLens only uses LSTM OCR,
 * so pin the worker to the portable LSTM core and keep the fallback small.
 */

const { parentPort } = require("node:worker_threads");
const worker = require("tesseract.js/src/worker-script");
const getCore = require("tesseract.js-core/tesseract-core-lstm");
const gunzip = require("tesseract.js/src/worker-script/node/gunzip");
const cache = require("tesseract.js/src/worker-script/node/cache");

parentPort.on("message", (packet) => {
  worker.dispatchHandlers(packet, (response) => parentPort.postMessage(response));
});

worker.setAdapter({
  getCore: async () => getCore,
  gunzip,
  fetch: global.fetch || require("node-fetch"),
  ...cache,
});
