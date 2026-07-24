import {safeLogFields} from './redaction';

const compactMessage = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, 240)
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/(\/transactions\/)[^\s/?#]+/gi, '$1[redacted]');
};

export function appleExceptionFields(error: unknown): Record<string, unknown> {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const exceptionType = error instanceof Error
    ? error.constructor?.name || 'Error'
    : error === null ? 'null' : typeof error;
  const httpStatus = typeof value.httpStatusCode === 'number' ? value.httpStatusCode
    : typeof value.status === 'number' ? value.status : undefined;
  const apiError = typeof value.apiError === 'number' || typeof value.apiError === 'string'
    ? value.apiError : undefined;
  const errorCode = typeof value.code === 'number' || typeof value.code === 'string'
    ? value.code : undefined;
  const message = compactMessage(error instanceof Error ? error.message : value.message);
  return {exceptionType, httpStatus, apiError, errorCode, message};
}

export function logAppleDiagnostic(
  level: 'info' | 'warn',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = safeLogFields({event, ...fields});
  if (level === 'warn') console.warn('[apple-verification-diagnostic]', payload);
  else console.info('[apple-verification-diagnostic]', payload);
}
