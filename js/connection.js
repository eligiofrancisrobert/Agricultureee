import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Shared Supabase client using session storage for persisted browser sessions. */
// Replace these placeholders with your own Supabase credentials.
const SUPABASE_URL = 'https://atatxxwupdohxznwilak.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXR4eHd1cGRvaHh6bndpbGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzODgxNzIsImV4cCI6MjEwNjk2NDE3Mn0.swFWAGG9r7V22Dppt_Rfy1spUK48JXt3XaBdBZIwY5g';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
