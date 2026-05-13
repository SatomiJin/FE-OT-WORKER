import {
  clearPersistedDebugLogs,
  exchangeCodeForSessionIfPresent,
  getAuthConfig,
  getSession,
  getUserSnapshot,
  isAuthConfigured,
  replayPersistedDebugLogs,
  signInWithGoogle,
  signOut
} from "./auth.js";

const LOGIN_LOG_PREFIX = "[OT Login]";
const loginButton = document.querySelector("#loginButton");
const continueButton = document.querySelector("#continueButton");
const signOutButton = document.querySelector("#signOutButton");
const statusText = document.querySelector("#authMessage");
const authDetails = document.querySelector("#authDetails");
const authEmail = document.querySelector("#authEmail");
const authMeta = document.querySelector("#authMeta");
const authAvatar = document.querySelector("#authAvatar");
const authAvatarFallback = document.querySelector("#authAvatarFallback");
const configHint = document.querySelector("#configHint");
let redirectHandle = 0;

function logLogin(step, detail) {
  if (detail === undefined) {
    console.log(`${LOGIN_LOG_PREFIX} ${step}`);
    return;
  }
  console.log(`${LOGIN_LOG_PREFIX} ${step}`, detail);
}

logLogin("Module loaded", {
  href: window.location.href,
  hasLoginButton: Boolean(loginButton),
  hasContinueButton: Boolean(continueButton),
  hasSignOutButton: Boolean(signOutButton)
});
replayPersistedDebugLogs("login page");

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickedLoginButton = target.closest("#loginButton");
    if (clickedLoginButton) {
      logLogin("Document captured click on login button", {
        tagName: target.tagName,
        text: clickedLoginButton.textContent?.trim() ?? ""
      });
    }
  },
  true
);

loginButton.addEventListener("pointerdown", () => {
  logLogin("Login button pointerdown");
  loginButton.dataset.debugState = "pressed";
});

loginButton.addEventListener("mousedown", () => {
  logLogin("Login button mousedown");
});

function setMessage(message, isError = false) {
  statusText.textContent = message;
  statusText.dataset.state = isError ? "error" : "info";
}

function getInitials(displayName, email) {
  const name = displayName || email || "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function renderAvatar(user) {
  const initials = getInitials(user.displayName, user.email);
  authAvatarFallback.textContent = initials;

  if (user.avatarUrl) {
    authAvatar.src = user.avatarUrl;
    authAvatar.alt = user.displayName || user.email || "Avatar";
    authAvatar.hidden = false;
    authAvatarFallback.hidden = true;

    authAvatar.onerror = () => {
      authAvatar.hidden = true;
      authAvatarFallback.hidden = false;
    };
  } else {
    authAvatar.hidden = true;
    authAvatarFallback.hidden = false;
  }
}

function renderSignedOut() {
  authDetails.hidden = true;
  continueButton.hidden = true;
  signOutButton.hidden = true;
  loginButton.hidden = false;
  loginButton.disabled = false;
  loginButton.innerHTML = `
    <svg class="auth-google-icon" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
    Đăng nhập với Google`;
}

function renderSignedIn(session) {
  const user = getUserSnapshot(session);
  logLogin("Render signed-in state", {
    userId: user.id,
    email: user.email,
    appUrl: getAuthConfig().appUrl
  });

  renderAvatar(user);
  authDetails.hidden = false;
  continueButton.hidden = false;
  signOutButton.hidden = false;
  loginButton.hidden = true;

  authEmail.textContent = user.displayName || user.email || "Người dùng";
  authMeta.textContent = user.email || "";

  setMessage("Đăng nhập Google thành công. Đang chuyển vào trang chính...");
  window.clearTimeout(redirectHandle);
  redirectHandle = window.setTimeout(() => {
    logLogin("Redirecting to app", { appUrl: getAuthConfig().appUrl });
    window.location.replace(getAuthConfig().appUrl);
  }, 1200);
}

async function syncView() {
  logLogin("syncView start", { href: window.location.href });
  if (!isAuthConfigured()) {
    configHint.hidden = false;
    renderSignedOut();
    setMessage("Chưa có Supabase anon key trong public/auth-config.js.", true);
    return;
  }

  configHint.hidden = true;
  await exchangeCodeForSessionIfPresent();
  const session = await getSession();

  if (!session) {
    logLogin("No session on login page");
    renderSignedOut();
    setMessage("Đăng nhập bằng tài khoản Google để bắt đầu sử dụng OT Tracker.");
    return;
  }

  logLogin("Session found on login page");
  renderSignedIn(session);
}

loginButton.addEventListener("click", async () => {
  try {
    clearPersistedDebugLogs();
    logLogin("Login button clicked");
    loginButton.innerHTML = `<span class="auth-spinner"></span> Đang mở Google login...`;
    loginButton.disabled = true;
    setMessage("Đang chuyển sang trang đăng nhập Google...");
    await signInWithGoogle();
    logLogin("signInWithGoogle resolved without immediate redirect");
  } catch (error) {
    renderSignedOut();
    console.error(`${LOGIN_LOG_PREFIX} Login button flow failed`, error);
    setMessage(error instanceof Error ? error.message : String(error), true);
  }
});

continueButton.addEventListener("click", () => {
  logLogin("Continue button clicked", { appUrl: getAuthConfig().appUrl });
  window.location.href = getAuthConfig().appUrl;
});

signOutButton.addEventListener("click", async () => {
  try {
    logLogin("Sign-out button clicked");
    signOutButton.disabled = true;
    signOutButton.textContent = "Đang đăng xuất...";
    await signOut();
    renderSignedOut();
    setMessage("Đã đăng xuất thành công.");
  } catch (error) {
    signOutButton.disabled = false;
    signOutButton.textContent = "Đăng xuất";
    console.error(`${LOGIN_LOG_PREFIX} Sign out failed`, error);
    setMessage(error instanceof Error ? error.message : String(error), true);
  }
});

void syncView();
