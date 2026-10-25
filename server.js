#!/usr/bin/env node
/**
 * VoidFlippr entry point.
 *
 * Starts the HTTP server. Run with:
 *   npm start
 *   node server.js            (defaults to port 9865)
 *   PORT=3000 node server.js  (override the port)
 *
 * The server has no runtime dependencies, so it runs on any host with
 * Node.js 18+ without an install step.
 */

import { start } from './server/index.js';

start();