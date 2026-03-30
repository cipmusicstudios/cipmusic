import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const client = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  const { data, error } = await client.from('artists').select('*').eq('name', 'HUNTR/X');
  console.log("Artists Error:", error);
  console.log("Artists Data:", JSON.stringify(data, null, 2));
}

run();
