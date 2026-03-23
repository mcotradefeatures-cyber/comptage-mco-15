/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://doygmzbgtiaylwfspsdf.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRveWdtemJndGlheWx3ZnNwc2RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMTYxODMsImV4cCI6MjA4Nzg5MjE4M30.yYba9R9k2hl956hPr1KnLNCPPqplSaBZqKat6WtMkMg';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: (url, init) => fetch(url, init),
  },
});
