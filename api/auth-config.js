function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export default function handler(request, response) {
  const authConfig = {
    supabaseUrl: pickFirstNonEmpty(
      process.env.SUPABASE_URL,
      process.env.SUPABASEURL,
    ),
    supabaseAnonKey: pickFirstNonEmpty(
      process.env.SUPABASE_ANON_KEY,
      process.env.SUPABASEANONKEY,
    ),
    apiBaseUrl: pickFirstNonEmpty(
      process.env.API_BASE_URL,
      process.env.APIBASEURL,
    ),
    loginPath: pickFirstNonEmpty(
      process.env.LOGIN_PATH,
      process.env.LOGINPATH,
      "/login.html",
    ),
    appPath: pickFirstNonEmpty(process.env.APP_PATH, process.env.APPPATH, "/"),
  };
  const authConfigDebug = {
    hasSupabaseUrl: Boolean(authConfig.supabaseUrl),
    hasSupabaseAnonKey: Boolean(authConfig.supabaseAnonKey),
    hasApiBaseUrl: Boolean(authConfig.apiBaseUrl),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
  };

  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response
    .status(200)
    .send(
      `window.OT_AUTH = ${JSON.stringify(authConfig, null, 2)};\nwindow.OT_AUTH_DEBUG = ${JSON.stringify(authConfigDebug, null, 2)};\n`,
    );
}
