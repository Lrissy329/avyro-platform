import { createClient } from '@supabase/supabase-js';

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await client
  .from('listings')
  .select('id, photos')
  .eq('title', 'Lovely Flat')
  .maybeSingle();

if (error) {
  console.error(error);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
