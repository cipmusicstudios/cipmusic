import {withLambda} from '@netlify/aws-lambda-compat';
import type {HandlerEvent, HandlerResponse} from '@netlify/functions';
import {defaultSupabase, json} from './_shared/apple/http';
import {createNotificationHandler} from './_shared/apple/notification-handler';

const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const supabase = defaultSupabase();
  if (!supabase) return json(503, {ok: false, code: 'SERVICE_ENV_INCOMPLETE'});
  return createNotificationHandler('production', {supabase})(event);
};

export default withLambda(event => handler(event as HandlerEvent));
