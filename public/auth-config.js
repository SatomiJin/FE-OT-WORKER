const isLocalPreview =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

window.OT_AUTH = {
  supabaseUrl: "https://gwvjzrvycgppawwfhbkl.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3dmp6cnZ5Y2dwcGF3d2ZoYmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDg4NjgsImV4cCI6MjA5NDA4NDg2OH0.Yo-Iba5UW2USMUtI9w02fAlKJkh-ihsXggoDOZwsjI4",
  apiBaseUrl: isLocalPreview ? "https://be-ot-worker.vercel.app" : "",
  loginPath: "/login.html",
  appPath: "/",
};
