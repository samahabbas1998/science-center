// =====================================================================
//  YOUR SETTINGS — the only file you need to edit.
//  Leave SUPABASE_URL empty to run the site in DEMO mode (fake data,
//  saved only in your browser) so you can try everything first.
// =====================================================================
window.CONFIG = {
  SITE_NAME: 'The Science Center · مركز العلوم',

  // From Supabase → Project Settings → API (or "Connect" button)
  SUPABASE_URL: 'https://qnansyksgdhvurjadlyi.supabase.co',        // looks like: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_ChW9m0LDp3WJDyGRaDEFfA_TcaduAsP',   // the "anon public" / "publishable" key (safe to share)

  // Usernames are turned into hidden login emails like  username@THIS-DOMAIN.
  // No email is ever sent. You don't need to own this domain.
  USERNAME_EMAIL_DOMAIN: 'users.tutoring-center.app',

  CURRENCY: '₪',
  SUBJECTS: ['Math', 'Physics', 'Electronics', 'Computer Science'],
  DEFAULT_DURATION: 60,     // minutes
};
