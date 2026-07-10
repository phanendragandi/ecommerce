import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: 'Not found' });
}

// Small allowlist of safe, generic messages for well-known client-error
// statuses surfaced by framework/middleware errors (e.g. body-parser's
// PayloadTooLargeError / JSON SyntaxError) that aren't our own HttpError.
// We NEVER echo err.message for these — only a status-appropriate generic
// string — so upstream library internals can't leak to the client.
const SAFE_CLIENT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Malformed request body',
  413: 'Payload too large',
};

/**
 * Extracts a numeric 4xx status from an unknown error (as set by Express/
 * body-parser on things like PayloadTooLargeError or JSON SyntaxError),
 * if present. Returns null for anything without a plausible client-error
 * status, including any 5xx-carrying error (those still hit the 500 path).
 */
function getClientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) {
    return null;
  }
  const candidate =
    (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 499) {
    return candidate;
  }
  return null;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }

  // Framework/middleware errors (e.g. body-parser) that carry a correct
  // 4xx status but aren't our own HttpError/ZodError — honor their status,
  // never their message.
  const clientStatus = getClientErrorStatus(err);
  if (clientStatus !== null) {
    res.status(clientStatus).json({
      success: false,
      message: SAFE_CLIENT_ERROR_MESSAGES[clientStatus] ?? 'Bad request',
    });
    return;
  }

  // Never leak internals (stack traces, driver errors) to clients.
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  if (!config.isProd && err instanceof Error) {
    console.error(err.stack);
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
}
