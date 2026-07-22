import type {HandlerEvent, HandlerResponse} from '@netlify/functions';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createSupabaseServiceClient} from '../supabase-service';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(statusCode: number, body: unknown): HandlerResponse {
  return {statusCode, headers: {'Content-Type': 'application/json', ...CORS_HEADERS}, body: JSON.stringify(body)};
}

export function bearer(event: Pick<HandlerEvent, 'headers'>): string | null {
  const raw = event.headers?.authorization || event.headers?.Authorization;
  const match = typeof raw === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(raw.trim()) : null;
  return match?.[1] ?? null;
}

export function defaultSupabase(): SupabaseClient | null {
  return createSupabaseServiceClient();
}
