import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://hngtwkayovuxhiqustsa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuZ3R3a2F5b3Z1eGhpcXVzdHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI2MzcxNDIsImV4cCI6MjA1ODIxMzE0Mn0.UOhc1O9vjH6e1I-Y_yA2f1v-bN-1u9sW1a9y5-6V-n4' // Wait, I'll read it from process.env instead
);

// We need dotenv
import 'dotenv/config';

const client = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  const { data, error } = await client.from('songs').select('*').eq('title', 'Golden Piano');
  console.log("Error:", error);
  console.log("Data:", data);
}

run();
