import type {Handler, HandlerEvent, HandlerResponse} from '@netlify/functions';
import {createHash} from 'crypto';
import {createSupabaseServiceClient} from './_shared/supabase-service';
import {revokeStoredAppleToken} from './_shared/apple-sign-in';

const APP_DATA_TABLES = ['user_favorites', 'user_recently_played', 'user_membership'] as const;
const RETAINED_PAYMENT_TABLES = ['membership_orders', 'membership_google_play_purchases'] as const;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DeleteStep =
  | {table: (typeof APP_DATA_TABLES)[number]; status: 'deleted'; count: number | null}
  | {table: (typeof APP_DATA_TABLES)[number]; status: 'skipped_missing_table'};

type RetainedPaymentStep =
  | {table: (typeof RETAINED_PAYMENT_TABLES)[number]; status: 'anonymized'; count: number | null}
  | {table: (typeof RETAINED_PAYMENT_TABLES)[number]; status: 'skipped_missing_table'};

type DeleteAccountDebug = {
  hasAuthHeader: boolean;
  authValid: boolean;
  supabaseConfigured: boolean;
  deletionAttempted: boolean;
  missingEnv?: string[];
  errorStage?: string;
  errorMessage?: string | null;
  supabaseErrorCode?: string | null;
};

function collectMissingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {'Content-Type': 'application/json', ...corsHeaders},
    body: JSON.stringify(body),
  };
}

function fail(
  status: number,
  code: string,
  message: string,
  debug: DeleteAccountDebug,
): HandlerResponse {
  return json(status, {
    ok: false,
    code,
    error: code,
    message,
    debug,
  });
}

function parseAuthHeader(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  const raw =
    headers['authorization'] ||
    headers['Authorization'] ||
    (headers as Record<string, string | undefined>)['AUTHORIZATION'];
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token || null;
}

function logLine(fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
      safe[k] = v;
    }
  }
  console.log('[delete-account]', JSON.stringify(safe));
}

function deletionHash(userId: string): string {
  const salt = process.env.ACCOUNT_DELETION_HASH_SALT?.trim() || 'aurasounds-account-deletion-v1';
  return createHash('sha256').update(`${salt}:${userId}`).digest('hex');
}

function isMissingTableError(error: {code?: string | null; message?: string | null}): boolean {
  const code = error.code != null ? String(error.code) : '';
  const message = error.message ?? '';
  return code === '42P01' || code === 'PGRST205' || /relation .* does not exist/i.test(message);
}

async function anonymizeRetainedPaymentRows(
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  table: (typeof RETAINED_PAYMENT_TABLES)[number],
  userId: string,
  deletedUserHash: string,
): Promise<RetainedPaymentStep> {
  const {error, count} = await supabase
    .from(table)
    .update(
      {
        user_id: null,
        deleted_user_hash: deletedUserHash,
        account_deleted_at: new Date().toISOString(),
      },
      {count: 'exact'},
    )
    .eq('user_id', userId);

  if (error) {
    if (isMissingTableError(error)) {
      return {table, status: 'skipped_missing_table'};
    }
    throw Object.assign(new Error(error.message), {
      table,
      code: error.code != null ? String(error.code) : null,
    });
  }

  return {table, status: 'anonymized', count: count ?? null};
}

async function deleteAppRows(
  supabase: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  table: (typeof APP_DATA_TABLES)[number],
  userId: string,
): Promise<DeleteStep> {
  const {error, count} = await supabase
    .from(table)
    .delete({count: 'exact'})
    .eq('user_id', userId);

  if (error) {
    if (isMissingTableError(error)) {
      return {table, status: 'skipped_missing_table'};
    }
    throw Object.assign(new Error(error.message), {
      table,
      code: error.code != null ? String(error.code) : null,
    });
  }

  return {table, status: 'deleted', count: count ?? null};
}

function baseDebug(partial: Partial<DeleteAccountDebug> = {}): DeleteAccountDebug {
  return {
    hasAuthHeader: false,
    authValid: false,
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    deletionAttempted: false,
    missingEnv: collectMissingSupabaseEnv(),
    ...partial,
  };
}

/**
 * Account deletion broker for Apple Guideline 5.1.1(v).
 *
 * The mobile client sends only the user's Supabase access token. The user id
 * is derived from the verified JWT, never from request body input. Payment and
 * order records are deliberately retained for legal/accounting/fraud history.
 *
 * Hard delete requires `supabase/account-deletion-hard-delete-compat.sql`:
 * retained transaction tables must allow user_id to be nulled / SET NULL before
 * the auth user row is physically removed.
 */
export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 204, headers: corsHeaders, body: ''};
  }

  if (event.httpMethod !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'POST required', baseDebug({errorStage: 'wrong_method'}));
  }

  const token = parseAuthHeader(event);
  if (!token) {
    logLine({stage: 'no_bearer', ok: false});
    return fail(
      401,
      'UNAUTHENTICATED',
      'Missing Authorization: Bearer <supabase_access_token>',
      baseDebug({errorStage: 'no_bearer'}),
    );
  }

  const missingEnv = collectMissingSupabaseEnv();
  if (missingEnv.length > 0) {
    logLine({stage: 'env_missing', ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Netlify Functions.',
      baseDebug({hasAuthHeader: true, errorStage: 'env_missing'}),
    );
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    logLine({stage: 'no_service_client', ok: false});
    return fail(
      503,
      'SERVICE_ENV_INCOMPLETE',
      'Could not create Supabase service client.',
      baseDebug({hasAuthHeader: true, errorStage: 'no_service_client'}),
    );
  }

  const userRes = await supabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user?.id) {
    logLine({stage: 'jwt_invalid', ok: false});
    return fail(
      401,
      'INVALID_SESSION',
      'Supabase access token could not be verified.',
      baseDebug({
        hasAuthHeader: true,
        errorStage: 'jwt_invalid',
        errorMessage: userRes.error?.message ?? null,
      }),
    );
  }

  const userId = userRes.data.user.id;
  const deletedUserHash = deletionHash(userId);
  const deleted: DeleteStep[] = [];
  const retainedPaymentRows: RetainedPaymentStep[] = [];
  const appleRevocation = await revokeStoredAppleToken(supabase, userId);

  try {
    for (const table of RETAINED_PAYMENT_TABLES) {
      retainedPaymentRows.push(
        await anonymizeRetainedPaymentRows(supabase, table, userId, deletedUserHash),
      );
    }
  } catch (err) {
    const e = err as Error & {table?: string; code?: string | null};
    console.error('[delete-account] retained payment anonymization failed', {
      stage: 'retained_payment_anonymize_failed',
      table: e.table ?? null,
      code: e.code ?? null,
      message: e.message,
    });
    logLine({stage: 'retained_payment_anonymize_failed', ok: false, table: e.table ?? null});
    return fail(
      503,
      'RETAINED_PAYMENT_ANONYMIZE_FAILED',
      'Retained payment records could not be detached from the account. Confirm the hard-delete compatibility SQL migration has been applied.',
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        deletionAttempted: true,
        errorStage: 'retained_payment_anonymize_failed',
        errorMessage: e.message,
        supabaseErrorCode: e.code ?? null,
      }),
    );
  }

  try {
    for (const table of APP_DATA_TABLES) {
      deleted.push(await deleteAppRows(supabase, table, userId));
    }
  } catch (err) {
    const e = err as Error & {table?: string; code?: string | null};
    console.error('[delete-account] app data deletion failed', {
      stage: 'app_data_delete_failed',
      table: e.table ?? null,
      code: e.code ?? null,
      message: e.message,
    });
    logLine({stage: 'app_data_delete_failed', ok: false, table: e.table ?? null});
    return fail(
      503,
      'APP_DATA_DELETE_FAILED',
      'Account app data could not be deleted.',
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        deletionAttempted: true,
        errorStage: 'app_data_delete_failed',
        errorMessage: e.message,
        supabaseErrorCode: e.code ?? null,
      }),
    );
  }

  const authDelete = await supabase.auth.admin.deleteUser(userId);
  if (authDelete.error) {
    logLine({stage: 'auth_delete_failed', ok: false});
    return fail(
      503,
      'AUTH_DELETE_FAILED',
      'Supabase auth account could not be deleted.',
      baseDebug({
        hasAuthHeader: true,
        authValid: true,
        deletionAttempted: true,
        errorStage: 'auth_delete_failed',
        errorMessage: authDelete.error.message,
        supabaseErrorCode:
          'status' in authDelete.error && authDelete.error.status != null
            ? String(authDelete.error.status)
            : null,
      }),
    );
  }

  logLine({stage: 'ok', ok: true, deletedTables: deleted.length});
  return json(200, {
    ok: true,
    authDeletionMode: 'hard_delete',
    deleted,
    retainedPaymentRows,
    retained: [
      'Payment and order records are retained as required for legal, accounting, fraud-prevention, and subscription reconciliation purposes.',
      'External App Store, Google Play, Stripe, ZPAY, and marketplace transaction records are not deleted by this app endpoint.',
    ],
    appleCredentialRevocation: appleRevocation.status,
    ...(appleRevocation.status === 'not_configured'
      ? {appleCredentialRevocationMissingEnv: appleRevocation.missingEnv}
      : {}),
    ...(appleRevocation.status === 'failed'
      ? {appleCredentialRevocationError: appleRevocation.message}
      : {}),
  });
};
