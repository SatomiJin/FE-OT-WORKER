import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let supabaseClient;
const AUTH_LOG_PREFIX = "[OT Auth]";
const DEBUG_LOG_STORAGE_KEY = "ot-debug-logs";

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function logAuth(step, detail) {
  persistDebugLog(AUTH_LOG_PREFIX, step, detail);
  if (detail === undefined) {
    console.log(`${AUTH_LOG_PREFIX} ${step}`);
    return;
  }

  console.log(`${AUTH_LOG_PREFIX} ${step}`, detail);
}

function persistDebugLog(prefix, step, detail) {
  try {
    const logs = JSON.parse(
      sessionStorage.getItem(DEBUG_LOG_STORAGE_KEY) || "[]",
    );
    logs.push({
      time: new Date().toISOString(),
      prefix,
      step,
      detail: detail ?? null,
    });
    sessionStorage.setItem(
      DEBUG_LOG_STORAGE_KEY,
      JSON.stringify(logs.slice(-200)),
    );
  } catch {
    // Ignore debug logging failures so auth flow is not affected.
  }
}

export function replayPersistedDebugLogs(scope = "unknown") {
  try {
    const logs = JSON.parse(
      sessionStorage.getItem(DEBUG_LOG_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(logs) || logs.length === 0) {
      return;
    }

    console.groupCollapsed(
      `[OT Debug Replay] ${scope} (${logs.length} entries)`,
    );
    for (const entry of logs) {
      const line = `${entry.time} ${entry.prefix} ${entry.step}`;
      if (entry.detail === null || entry.detail === undefined) {
        console.log(line);
      } else {
        console.log(line, entry.detail);
      }
    }
    console.groupEnd();
  } catch {
    // Ignore replay failures.
  }
}

export function clearPersistedDebugLogs() {
  try {
    sessionStorage.removeItem(DEBUG_LOG_STORAGE_KEY);
  } catch {
    // Ignore clear failures.
  }
}

export function getAuthConfig() {
  const authConfig = window.OT_AUTH ?? {};
  const origin = window.location.origin;
  const loginPath = authConfig.loginPath ?? "/login.html";
  const appPath = authConfig.appPath ?? "/";

  return {
    supabaseUrl: trimTrailingSlash(authConfig.supabaseUrl),
    supabaseAnonKey: String(authConfig.supabaseAnonKey ?? "").trim(),
    apiBaseUrl: trimTrailingSlash(
      authConfig.apiBaseUrl ?? window.OT_API_BASE_URL ?? "",
    ),
    loginUrl: new URL(loginPath, origin).toString(),
    appUrl: new URL(appPath, origin).toString(),
  };
}

export function isAuthConfigured() {
  const config = getAuthConfig();
  return Boolean(
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    config.supabaseAnonKey !== "REPLACE_WITH_SUPABASE_ANON_KEY",
  );
}

export function getSupabaseClient() {
  if (supabaseClient) {
    logAuth("Reuse existing Supabase client");
    return supabaseClient;
  }

  const config = getAuthConfig();
  if (!isAuthConfigured()) {
    throw new Error(
      "Supabase client config is missing. Update public/auth-config.js before using Google login.",
    );
  }

  supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  logAuth("Created Supabase client", {
    supabaseUrl: config.supabaseUrl,
    loginUrl: config.loginUrl,
    appUrl: config.appUrl,
    apiBaseUrl: config.apiBaseUrl,
  });

  return supabaseClient;
}

export async function exchangeCodeForSessionIfPresent() {
  if (window.location.hash.includes("access_token=")) {
    logAuth("Detected access token in URL hash", {
      pathname: window.location.pathname,
      hashPreview: `${window.location.hash.slice(0, 48)}...`,
    });
    const session = await getSession();
    logAuth("Session after hash callback", {
      hasSession: Boolean(session),
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    });
    return session;
  }

  if (!window.location.search.includes("code=")) {
    logAuth("No auth code in URL", { href: window.location.href });
    return null;
  }

  const client = getSupabaseClient();
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");

  if (!code) {
    logAuth("URL contains code marker but no code value", {
      href: window.location.href,
    });
    return null;
  }

  logAuth("Exchanging auth code for session", {
    pathname: url.pathname,
    search: url.search,
    codeLength: code.length,
  });
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`${AUTH_LOG_PREFIX} Exchange code failed`, error);
    throw error;
  }

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState(
    {},
    document.title,
    url.pathname + url.search + url.hash,
  );
  logAuth("Exchange success", {
    hasSession: Boolean(data.session),
    userId: data.session?.user?.id ?? null,
    email: data.session?.user?.email ?? null,
  });
  return data.session ?? null;
}

export async function getSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error(`${AUTH_LOG_PREFIX} getSession failed`, error);
    throw error;
  }

  logAuth("Read current session", {
    hasSession: Boolean(data.session),
    userId: data.session?.user?.id ?? null,
    email: data.session?.user?.email ?? null,
  });
  return data.session ?? null;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token ?? "";
}

export async function refreshSession() {
  const client = getSupabaseClient();
  logAuth("Refreshing session");
  const { data, error } = await client.auth.refreshSession();
  if (error) {
    console.error(`${AUTH_LOG_PREFIX} refreshSession failed`, error);
    throw error;
  }

  logAuth("Refresh session result", {
    hasSession: Boolean(data.session),
    userId: data.session?.user?.id ?? null,
  });
  return data.session ?? null;
}

export async function requireSession() {
  logAuth("requireSession start", { href: window.location.href });
  await exchangeCodeForSessionIfPresent();
  const session = await getSession();

  if (session) {
    logAuth("requireSession success", {
      userId: session.user?.id ?? null,
      email: session.user?.email ?? null,
    });
    return session;
  }

  logAuth("No session found, redirecting to login", {
    loginUrl: getAuthConfig().loginUrl,
  });
  window.location.replace(getAuthConfig().loginUrl);
  return null;
}

export function getUserSnapshot(session) {
  const user = session?.user;
  const metadata = user?.user_metadata ?? {};

  return {
    id: user?.id ?? "",
    email: user?.email ?? "",
    displayName: String(
      metadata.full_name ?? metadata.name ?? user?.email ?? "Unknown user",
    ).trim(),
    avatarUrl: String(metadata.avatar_url ?? metadata.picture ?? "").trim(),
  };
}

export async function signInWithGoogle() {
  const client = getSupabaseClient();
  logAuth("Starting Google sign-in", { redirectTo: getAuthConfig().appUrl });
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthConfig().appUrl,
    },
  });

  if (error) {
    console.error(`${AUTH_LOG_PREFIX} signInWithGoogle failed`, error);
    throw error;
  }
}

export async function signOut() {
  const client = getSupabaseClient();
  logAuth("Signing out current user");
  const { error } = await client.auth.signOut();
  if (error) {
    console.error(`${AUTH_LOG_PREFIX} signOut failed`, error);
    throw error;
  }

  logAuth("Sign out success");
}
