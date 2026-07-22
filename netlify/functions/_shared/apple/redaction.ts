import {createHash} from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function appAccountTokenHash(value: string): string {
  return sha256(`cipmusic:app-account-token:v1:${value.toLowerCase()}`);
}

export function opaqueRef(value: string | null | undefined): string | null {
  return value ? sha256(value).slice(0, 12) : null;
}

const SENSITIVE_KEYS = /jws|receipt|signed|payload|token|secret|private|transaction.?id|original.?transaction|user.?id|uuid/i;

export function safeLogFields(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    SENSITIVE_KEYS.test(key) && typeof value === 'string' ? opaqueRef(value) : value,
  ]));
}
