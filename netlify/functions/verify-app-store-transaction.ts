import type {Handler} from '@netlify/functions';
import {defaultSupabase, json} from './_shared/apple/http';
import {createVerifyHandler} from './_shared/apple/verify-handler';

export const handler: Handler = async event => {
  const supabase = defaultSupabase();
  if (!supabase) return json(503, {ok: false, code: 'SERVICE_ENV_INCOMPLETE'});
  return createVerifyHandler({supabase})(event);
};
