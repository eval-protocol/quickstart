/**
 * Winston logger configuration with Fireworks tracing transport
 */

import winston from 'winston';
import { FireworksTransport } from './fireworks-transport.js';

// Global reference to waitUntil function
let globalWaitUntil: ((promise: Promise<any>) => void) | undefined;

// Set waitUntil function (called from Vercel handler)
export function setWaitUntil(waitUntil: (promise: Promise<any>) => void) {
  globalWaitUntil = waitUntil;
}

// Create the logger with Fireworks transport
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console transport for local development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Fireworks transport - equivalent to FireworksTracingHttpHandler
    new FireworksTransport({
      waitUntil: (promise: Promise<any>) => globalWaitUntil?.(promise)
    })
  ]
});

/**
 * Create a child logger with rollout_id context
 */
export function createRolloutLogger(rolloutId: string, name: string = 'init'): winston.Logger {
  return logger.child({
    rollout_id: rolloutId,
    logger_name: `${name}.${rolloutId}`
  });
}

