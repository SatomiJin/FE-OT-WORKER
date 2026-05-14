import {
  getAccessToken,
  getAuthConfig,
  getUserSnapshot,
  replayPersistedDebugLogs,
  refreshSession,
  requireSession,
  signOut
} from "./auth.js";

function toast(message, type = "info") {
  const backgrounds = {
    success: "linear-gradient(135deg, #2e7d32, #43a047)",
    error: "linear-gradient(135deg, #c62828, #e53935)",
    info: "linear-gradient(135deg, #1565c0, #1e88e5)",
    warning: "linear-gradient(135deg, #e65100, #fb8c00)"
  };
  Toastify({
    text: message,
    duration: type === "error" ? 5000 : 3000,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: { background: backgrounds[type] ?? backgrounds.info }
  }).showToast();
}

function toastConfirm(message) {
  return window.confirm(message);
}

const API_BASE_URL = getAuthConfig().apiBaseUrl;
const APP_LOG_PREFIX = "[OT App]";
const API_LOG_PREFIX = "[OT API]";

function logApp(step, detail) {
  void step;
  void detail;
}

function logApi(step, detail) {
  void step;
  void detail;
}

function formatRequestError(error, fallbackMessage = "Request failed.") {
  if (!error) {
    return fallbackMessage;
  }

  const statusText = error.status ? ` [HTTP ${error.status}]` : "";
  const message = error.message ? String(error.message).trim() : fallbackMessage;
  return `${message}${statusText}`;
}

replayPersistedDebugLogs("app page");

const state = {
  suggestedUsername: "",
  activeUsername: "",
  profiles: {},
  profileSaveHandle: 0,
  timerNoteSaveHandle: 0
};

const profileForm = document.querySelector("#profileForm");
const usernameInput = document.querySelector("#usernameInput");
const employeeForm = document.querySelector("#employeeForm");
const entryForm = document.querySelector("#entryForm");
const exportMonthInput = document.querySelector("#exportMonth");
const profileList = document.querySelector("#profileList");
const entryTableBody = document.querySelector("#entryTableBody");
const saveJsonButton = document.querySelector("#saveJsonButton");
const exportButton = document.querySelector("#exportButton");
const importJsonInput = document.querySelector("#importJsonInput");
const importJsonButton = document.querySelector("#importJsonButton");
const resetFormButton = document.querySelector("#resetFormButton");
const createProfileButton = document.querySelector("#createProfileButton");
const deleteProfileButton = document.querySelector("#deleteProfileButton");
const entryCount = document.querySelector("#entryCount");
const monthHours = document.querySelector("#monthHours");
const emptyStateTemplate = document.querySelector("#emptyState");
const jsonPreview = document.querySelector("#jsonPreview");
const activeProfileName = document.querySelector("#activeProfileName");
const profileHint = document.querySelector("#profileHint");
const authDisplayName = document.querySelector("#authDisplayName");
const authSessionHint = document.querySelector("#authSessionHint");
const sessionAvatar = document.querySelector("#sessionAvatar");
const sessionAvatarFallback = document.querySelector("#sessionAvatarFallback");
const loginPageLink = document.querySelector("#loginPageLink");
const signOutButton = document.querySelector("#signOutButton");
const timerStatus = document.querySelector("#timerStatus");
const timerStartedAt = document.querySelector("#timerStartedAt");
const timerElapsed = document.querySelector("#timerElapsed");
const timerNoteInput = document.querySelector("#timerNoteInput");
const startTimerButton = document.querySelector("#startTimerButton");
const stopTimerButton = document.querySelector("#stopTimerButton");
const employeeFields = {
  label: employeeForm.elements.namedItem("label"),
  employeeCode: employeeForm.elements.namedItem("employeeCode"),
  fullName: employeeForm.elements.namedItem("fullName"),
  sheetName: employeeForm.elements.namedItem("sheetName")
};
const entryFields = {
  id: entryForm.elements.namedItem("id"),
  date: entryForm.elements.namedItem("date"),
  startTime: entryForm.elements.namedItem("startTime"),
  endTime: entryForm.elements.namedItem("endTime"),
  note: entryForm.elements.namedItem("note")
};
const timePickerRoots = Array.from(document.querySelectorAll("[data-time-picker]"));
const timePickerState = {
  activeRoot: null
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function slugifyUsername(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodePath(value) {
  return encodeURIComponent(String(value ?? ""));
}

function createBlankProfile(username = "my-profile") {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  return {
    username,
    selectedMonth: defaultMonth,
    employee: {
      label: username.slice(0, 4).toUpperCase() || "DEMO",
      employeeCode: "",
      fullName: "",
      sheetName: "Trang tinh1"
    },
    entries: [],
    activeTimer: null
  };
}

function sanitizeTimer(rawTimer) {
  if (!rawTimer || typeof rawTimer !== "object") {
    return null;
  }

  const startedAt = String(rawTimer.startedAt ?? "").trim();
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) {
    return null;
  }

  return {
    startedAt,
    note: String(rawTimer.note ?? "").trim()
  };
}

function sanitizeEntry(rawEntry) {
  return {
    id: String(rawEntry?.id ?? "").trim(),
    date: String(rawEntry?.date ?? "").trim(),
    startTime: String(rawEntry?.startTime ?? "").trim(),
    endTime: String(rawEntry?.endTime ?? "").trim(),
    note: String(rawEntry?.note ?? "").trim()
  };
}

function sanitizeProfile(rawProfile, fallbackUsername = "my-profile") {
  const username = slugifyUsername(rawProfile?.username ?? fallbackUsername) || "my-profile";
  const employee = rawProfile?.employee ?? {};
  const entries = Array.isArray(rawProfile?.entries) ? rawProfile.entries : [];

  return {
    username,
    selectedMonth: String(rawProfile?.selectedMonth ?? "").trim(),
    employee: {
      label: String(employee.label ?? (username.slice(0, 4).toUpperCase() || "DEMO")).trim() || "DEMO",
      employeeCode: String(employee.employeeCode ?? "").trim(),
      fullName: String(employee.fullName ?? "").trim(),
      sheetName: String(employee.sheetName ?? "Trang tinh1").trim() || "Trang tinh1"
    },
    activeTimer: sanitizeTimer(rawProfile?.activeTimer),
    entries: entries
      .map((entry) => sanitizeEntry(entry))
      .filter((entry) => entry.id && entry.date && entry.startTime && entry.endTime)
  };
}

function mergeProfile(profile) {
  const normalizedProfile = sanitizeProfile(profile, profile?.username);
  state.profiles = {
    [normalizedProfile.username]: normalizedProfile
  };
  state.activeUsername = normalizedProfile.username;
  return normalizedProfile;
}

function removeProfileFromState(username) {
  const normalized = slugifyUsername(username);
  delete state.profiles[normalized];
  if (state.activeUsername === normalized) {
    state.activeUsername = "";
  }
}

function getActiveProfile() {
  return state.profiles[state.activeUsername];
}

function requireActiveProfile(actionLabel = "thuc hien thao tac nay") {
  const profile = getActiveProfile();
  if (!profile) {
    throw new Error(`Chua mo duoc ho so OT cua account hien tai, nen khong the ${actionLabel}. Hay bam "Tai ho so cua toi" truoc.`);
  }

  return profile;
}

function setActiveUsername(username) {
  const normalized = slugifyUsername(username);
  if (!normalized || !state.profiles[normalized]) {
    return false;
  }

  state.activeUsername = normalized;
  usernameInput.value = normalized;
  syncEmployeeForm();
  fillEntryForm();
  exportMonthInput.value = getSelectedMonthForProfile(getActiveProfile());
  renderAll();
  return true;
}

function guessMonthForProfile(profile) {
  const firstEntry = [...(profile?.entries ?? [])]
    .sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`))[0];

  if (firstEntry?.date?.slice(0, 7)) {
    return firstEntry.date.slice(0, 7);
  }

  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function getSelectedMonthForProfile(profile) {
  if (profile?.selectedMonth && /^\d{4}-\d{2}$/.test(profile.selectedMonth)) {
    return profile.selectedMonth;
  }

  return guessMonthForProfile(profile);
}

function minutesBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour === 24 ? 1440 : endHour * 60 + endMinute;
  const diff = end >= start ? end - start : 1440 - start + end;
  return diff;
}

function timeToMinutes(timeText) {
  const [hourText, minuteText] = timeText.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour === 24 ? 1440 : hour * 60 + minute;
}

function normalizeTime24h(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const isMidnightBoundary = hour === 24 && minute === 0;
  const isRegularTime = hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;

  if (!isMidnightBoundary && !isRegularTime) {
    return null;
  }

  return `${pad(hour)}:${pad(minute)}`;
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;

  if (hoursPart === 0) {
    return `${minutesPart}p`;
  }

  if (minutesPart === 0) {
    return `${hoursPart}h`;
  }

  return `${hoursPart}h${pad(minutesPart)}p`;
}

function formatDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimeInputValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimeDisplay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getTimer(profile = getActiveProfile()) {
  return sanitizeTimer(profile?.activeTimer);
}

function getTimerDurationMinutes(timer, endDate = new Date()) {
  if (!timer) {
    return 0;
  }

  const startedAt = new Date(timer.startedAt);
  if (Number.isNaN(startedAt.getTime())) {
    return 0;
  }

  const diffMs = endDate.getTime() - startedAt.getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

function buildEntryFromTimer(timer, endDate = new Date()) {
  const startedAt = new Date(timer.startedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return {
    id: "",
    date: formatDateInputValue(startedAt),
    startTime: formatTimeInputValue(startedAt),
    endTime: formatTimeInputValue(endDate),
    note: String(timer.note ?? "").trim()
  };
}

function getSelectedMonth() {
  const profile = getActiveProfile();
  return exportMonthInput.value || getSelectedMonthForProfile(profile);
}

function filteredEntriesForMonth() {
  const profile = getActiveProfile();
  const entries = profile?.entries ?? [];
  const month = getSelectedMonth();
  if (!month) {
    return [...entries];
  }

  return entries.filter((entry) => entry.date.startsWith(month));
}

function syncEmployeeForm() {
  const profile = getActiveProfile();
  const employee = profile?.employee ?? createBlankProfile().employee;
  employeeFields.label.value = employee.label ?? "";
  employeeFields.employeeCode.value = employee.employeeCode ?? "";
  employeeFields.fullName.value = employee.fullName ?? "";
  employeeFields.sheetName.value = employee.sheetName ?? "";
}

function fillEntryForm(entry = null) {
  entryFields.id.value = entry?.id ?? "";
  entryFields.date.value = entry?.date ?? "";
  const start = normalizeTime24h(entry?.startTime ?? "") ?? "";
  const end = normalizeTime24h(entry?.endTime ?? "") ?? "";
  entryFields.startTime.value = start;
  entryFields.endTime.value = end;
  entryFields.note.value = entry?.note ?? "";
  syncAllTimePickers();
}

function getTimeParts(timeText) {
  const normalized = normalizeTime24h(timeText);
  if (!normalized) {
    return null;
  }

  const [hourText, minuteText] = normalized.split(":");
  return {
    hour: Number(hourText),
    minute: Number(minuteText)
  };
}

function buildTimeOption(value, label, part) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "time-picker-option";
  option.dataset.value = String(value);
  option.dataset.part = part;
  option.textContent = label;
  return option;
}

function syncTimePicker(root) {
  if (!root) {
    return;
  }

  const input = root.querySelector(".time-picker-input");
  const parts = getTimeParts(input.value);
  const selectedHour = parts?.hour ?? null;
  const selectedMinute = parts?.minute ?? null;

  root.querySelectorAll(".time-picker-option").forEach((option) => {
    const optionValue = Number(option.dataset.value);
    const isHourOption = option.dataset.part === "hour";
    const selected = isHourOption ? optionValue === selectedHour : optionValue === selectedMinute;
    const disabled = !isHourOption && selectedHour === 24 && optionValue !== 0;
    option.classList.toggle("is-selected", selected);
    option.classList.toggle("is-disabled", disabled);
    option.disabled = disabled;
  });
}

function syncAllTimePickers() {
  timePickerRoots.forEach((root) => syncTimePicker(root));
}

function scrollSelectedOptionIntoView(root) {
  root.querySelectorAll(".time-picker-option.is-selected").forEach((option) => {
    option.scrollIntoView({
      block: "nearest"
    });
  });
}

function closeTimePicker(root) {
  if (!root) {
    return;
  }

  const popover = root.querySelector("[data-time-popover]");
  const input = root.querySelector(".time-picker-input");
  popover.hidden = true;
  input.setAttribute("aria-expanded", "false");
  root.classList.remove("is-open");

  if (timePickerState.activeRoot === root) {
    timePickerState.activeRoot = null;
  }
}

function openTimePicker(root) {
  if (!root) {
    return;
  }

  if (timePickerState.activeRoot && timePickerState.activeRoot !== root) {
    closeTimePicker(timePickerState.activeRoot);
  }

  const popover = root.querySelector("[data-time-popover]");
  const input = root.querySelector(".time-picker-input");
  popover.hidden = false;
  input.setAttribute("aria-expanded", "true");
  root.classList.add("is-open");
  timePickerState.activeRoot = root;
  syncTimePicker(root);
  scrollSelectedOptionIntoView(root);
}

function updateTimeInputValue(input, hour, minute) {
  const safeMinute = hour === 24 ? 0 : minute;
  input.value = `${pad(hour)}:${pad(safeMinute)}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function handleTimeOptionClick(option) {
  const root = option.closest("[data-time-picker]");
  const input = root.querySelector(".time-picker-input");
  const currentParts = getTimeParts(input.value) ?? { hour: 0, minute: 0 };
  const nextValue = Number(option.dataset.value);

  if (option.dataset.part === "hour") {
    updateTimeInputValue(input, nextValue, nextValue === 24 ? 0 : currentParts.minute);
    syncTimePicker(root);
    scrollSelectedOptionIntoView(root);
    if (nextValue === 24) {
      closeTimePicker(root);
    }
    return;
  }

  if (currentParts.hour === 24 && nextValue !== 0) {
    return;
  }

  updateTimeInputValue(input, currentParts.hour, nextValue);
  syncTimePicker(root);
  closeTimePicker(root);
}

function setupTimePickers() {
  timePickerRoots.forEach((root) => {
    const input = root.querySelector(".time-picker-input");
    const hourList = root.querySelector('[data-time-list="hour"]');
    const minuteList = root.querySelector('[data-time-list="minute"]');

    for (let hour = 0; hour <= 24; hour += 1) {
      hourList.append(buildTimeOption(hour, pad(hour), "hour"));
    }

    for (let minute = 0; minute <= 59; minute += 1) {
      minuteList.append(buildTimeOption(minute, pad(minute), "minute"));
    }

    root.addEventListener("click", (event) => {
      const option = event.target.closest(".time-picker-option");
      if (option) {
        handleTimeOptionClick(option);
        return;
      }

      if (event.target === input) {
        if (root.classList.contains("is-open")) {
          closeTimePicker(root);
        } else {
          openTimePicker(root);
        }
      }
    });

    input.addEventListener("focus", () => {
      openTimePicker(root);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openTimePicker(root);
      }

      if (event.key === "Escape") {
        closeTimePicker(root);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (timePickerState.activeRoot && !timePickerState.activeRoot.contains(event.target)) {
      closeTimePicker(timePickerState.activeRoot);
    }
  });

  syncAllTimePickers();
}

function syncStateFromEmployeeForm() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.employee = {
    label: employeeFields.label.value.trim() || "DEMO",
    employeeCode: employeeFields.employeeCode.value.trim(),
    fullName: employeeFields.fullName.value.trim(),
    sheetName: employeeFields.sheetName.value.trim() || "Trang tinh1"
  };
}

function serializeProfile(profile) {
  return {
    username: profile.username,
    selectedMonth: profile.selectedMonth,
    employee: {
      label: profile.employee.label,
      employeeCode: profile.employee.employeeCode,
      fullName: profile.employee.fullName,
      sheetName: profile.employee.sheetName
    },
    activeTimer: profile.activeTimer ? {
      startedAt: profile.activeTimer.startedAt,
      note: profile.activeTimer.note
    } : null,
    entries: profile.entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      note: entry.note
    }))
  };
}

function exportableProfile(profile = getActiveProfile()) {
  return profile ? serializeProfile(sanitizeProfile(profile, state.activeUsername)) : createBlankProfile();
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));
}

async function apiRequest(path, options = {}) {
  const { method = "GET", body, retryOnUnauthorized = true } = options;
  const token = await getAccessToken();
  logApi("Preparing request", {
    method,
    url: `${API_BASE_URL}${path}`,
    hasToken: Boolean(token),
    retryOnUnauthorized
  });

  if (!token) {
    console.error(`${API_LOG_PREFIX} Missing access token`, { path, method });
    throw new Error("Không tìm thấy Supabase access token. Hãy đăng nhập lại.");
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    console.error(`${API_LOG_PREFIX} Network request failed`, {
      method,
      url: `${API_BASE_URL}${path}`,
      error
    });
    throw error;
  }

  logApi("Received response", {
    method,
    url: `${API_BASE_URL}${path}`,
    status: response.status,
    ok: response.ok
  });

  if (response.status === 401 && retryOnUnauthorized) {
    try {
      logApi("Received 401, attempting refresh");
      const refreshedSession = await refreshSession();
      if (refreshedSession?.access_token) {
        logApi("Refresh succeeded, retrying request", { method, path });
        return apiRequest(path, {
          method,
          body,
          retryOnUnauthorized: false
        });
      }
    } catch {
      console.error(`${API_LOG_PREFIX} Refresh failed after 401, redirecting to login`);
      window.location.href = loginPageLink.href;
      return null;
    }
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    console.error(`${API_LOG_PREFIX} Request failed`, {
      method,
      url: `${API_BASE_URL}${path}`,
      status: response.status,
      payload
    });
    const error = new Error(
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : `Request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function apiRequestWithFallback(primaryPath, fallbackPath, options = {}) {
  try {
    return await apiRequest(primaryPath, options);
  } catch (error) {
    if (!fallbackPath || ![404, 405, 501].includes(error?.status)) {
      throw error;
    }

    logApi("Primary route unavailable, falling back", {
      primaryPath,
      fallbackPath,
      status: error.status
    });
    return apiRequest(fallbackPath, options);
  }
}

function getInitials(displayName, email) {
  const name = displayName || email || "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getSuggestedUsernameFromSession(session) {
  const user = getUserSnapshot(session);
  const emailPrefix = user.email.includes("@") ? user.email.split("@")[0] : user.email;
  return slugifyUsername(emailPrefix || user.displayName || user.id) || "my-profile";
}

function syncUsernameField() {
  const profile = getActiveProfile();
  if (profile) {
    usernameInput.value = profile.username;
    usernameInput.readOnly = true;
    return;
  }

  usernameInput.readOnly = false;
  usernameInput.value = state.suggestedUsername;
}

function renderAuthSession(session) {
  const user = getUserSnapshot(session);
  authDisplayName.textContent = user.displayName || user.email || "Người dùng";
  authSessionHint.textContent = user.email || "Đã xác thực";

  if (sessionAvatar && sessionAvatarFallback) {
    const initials = getInitials(user.displayName, user.email);
    sessionAvatarFallback.textContent = initials;

    if (user.avatarUrl) {
      sessionAvatar.src = user.avatarUrl;
      sessionAvatar.alt = user.displayName || user.email || "Avatar";
      sessionAvatar.hidden = false;
      sessionAvatarFallback.hidden = true;
      sessionAvatar.onerror = () => {
        sessionAvatar.hidden = true;
        sessionAvatarFallback.hidden = false;
      };
    } else {
      sessionAvatar.hidden = true;
      sessionAvatarFallback.hidden = false;
    }
  }
}

async function fetchMyProfileFromApi() {
  const username =
    slugifyUsername(getActiveProfile()?.username) ||
    slugifyUsername(usernameInput.value) ||
    state.suggestedUsername;

  return sanitizeProfile(
    await apiRequestWithFallback(
      "/api/profiles/me",
      username ? `/api/profiles/${encodePath(username)}` : null
    ),
    username || state.suggestedUsername
  );
}

async function createProfileInApi(username) {
  return sanitizeProfile(
    await apiRequestWithFallback(
      "/api/profiles/me/init",
      "/api/profiles",
      {
        method: "POST",
        body: { username }
      }
    ),
    username
  );
}

async function updateProfileInApi(profile) {
  return sanitizeProfile(
    await apiRequestWithFallback(
      "/api/profiles/me",
      `/api/profiles/${encodePath(profile.username)}`,
      {
        method: "PUT",
        body: {
          selectedMonth: profile.selectedMonth,
          employee: {
            label: profile.employee.label,
            employeeCode: profile.employee.employeeCode,
            fullName: profile.employee.fullName,
            sheetName: profile.employee.sheetName
          }
        }
      }
    ),
    profile.username
  );
}

async function deleteProfileInApi(username) {
  await apiRequest(`/api/profiles/${encodePath(username)}`, { method: "DELETE" });
}

async function createEntryInApi(username, entry) {
  return sanitizeEntry(
    await apiRequestWithFallback(
      "/api/profiles/me/entries",
      `/api/profiles/${encodePath(username)}/entries`,
      {
        method: "POST",
        body: {
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          note: entry.note
        }
      }
    )
  );
}

async function updateEntryInApi(username, entryId, entry) {
  return sanitizeEntry(
    await apiRequestWithFallback(
      `/api/profiles/me/entries/${encodePath(entryId)}`,
      `/api/profiles/${encodePath(username)}/entries/${encodePath(entryId)}`,
      {
        method: "PUT",
        body: {
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          note: entry.note
        }
      }
    )
  );
}

async function deleteEntryInApi(username, entryId) {
  await apiRequestWithFallback(
    `/api/profiles/me/entries/${encodePath(entryId)}`,
    `/api/profiles/${encodePath(username)}/entries/${encodePath(entryId)}`,
    { method: "DELETE" }
  );
}

async function startTimerInApi(username, note) {
  return sanitizeTimer(
    await apiRequestWithFallback(
      "/api/profiles/me/timer/start",
      `/api/profiles/${encodePath(username)}/timer/start`,
      {
        method: "POST",
        body: { note }
      }
    )
  );
}

async function updateTimerInApi(username, note) {
  return sanitizeTimer(
    await apiRequestWithFallback(
      "/api/profiles/me/timer",
      `/api/profiles/${encodePath(username)}/timer`,
      {
        method: "PUT",
        body: { note }
      }
    )
  );
}

async function stopTimerInApi(username, note) {
  return sanitizeEntry(
    await apiRequestWithFallback(
      "/api/profiles/me/timer/stop",
      `/api/profiles/${encodePath(username)}/timer/stop`,
      {
        method: "POST",
        body: { note }
      }
    )
  );
}

function renderProfileList() {
  profileList.innerHTML = "";
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile-chip profile-chip-active";
  button.dataset.username = profile.username;
  button.textContent = profile.username;
  profileList.append(button);
}

function renderStats() {
  const profile = getActiveProfile();
  const entries = profile?.entries ?? [];
  entryCount.textContent = String(entries.length);
  const totalMinutes = filteredEntriesForMonth().reduce(
    (sum, entry) => sum + minutesBetween(entry.startTime, entry.endTime),
    0
  );
  monthHours.textContent = formatDurationMinutes(totalMinutes);
}

function renderJsonPreview() {
  const profile = getActiveProfile();
  jsonPreview.value = JSON.stringify(exportableProfile(profile), null, 2);
}

function renderTimerPanel() {
  const profile = getActiveProfile();
  const timer = getTimer(profile);
  const hasProfile = Boolean(profile);

  timerNoteInput.disabled = !hasProfile;
  startTimerButton.disabled = !hasProfile || Boolean(timer);
  stopTimerButton.disabled = !timer;

  if (!profile) {
    timerStatus.textContent = "Chưa có hồ sơ để bấm giờ.";
    timerStartedAt.textContent = "--:--";
    timerElapsed.textContent = "0p";
    if (timerNoteInput.value) {
      timerNoteInput.value = "";
    }
    return;
  }

  if (!timer) {
    timerStatus.textContent = `Hồ sơ "${profile.username}" chưa có phiên OT nào đang chạy trên backend.`;
    timerStartedAt.textContent = "--:--";
    timerElapsed.textContent = "0p";
    if (timerNoteInput.value) {
      timerNoteInput.value = "";
    }
    return;
  }

  timerStatus.textContent = `Đang bấm giờ cho hồ sơ "${profile.username}". Khi dừng, backend sẽ tạo dòng OT mới.`;
  timerStartedAt.textContent = formatDateTimeDisplay(timer.startedAt);
  timerElapsed.textContent = formatDurationMinutes(getTimerDurationMinutes(timer));
  if (document.activeElement !== timerNoteInput && timerNoteInput.value !== (timer.note ?? "")) {
    timerNoteInput.value = timer.note ?? "";
  }
}

function renderTable() {
  const rows = sortEntries(filteredEntriesForMonth());

  entryTableBody.innerHTML = "";

  if (rows.length === 0) {
    entryTableBody.append(emptyStateTemplate.content.cloneNode(true));
    renderStats();
    renderJsonPreview();
    return;
  }

  rows.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${entry.date}</td>
      <td>${entry.startTime}</td>
      <td>${entry.endTime}</td>
      <td><span class="hours-badge">${formatDurationMinutes(minutesBetween(entry.startTime, entry.endTime))}</span></td>
      <td>${entry.note || ""}</td>
      <td>
        <div class="row-actions">
          <button class="edit" data-id="${entry.id}" type="button">Sua</button>
          <button class="delete" data-id="${entry.id}" type="button">Xoa</button>
        </div>
      </td>
    `;
    entryTableBody.append(tr);
  });

  renderStats();
  renderJsonPreview();
}

function renderProfileMeta() {
  const profile = getActiveProfile();
  if (!profile) {
    activeProfileName.textContent = "Chưa có hồ sơ";
    profileHint.textContent = "Account đang nhập hiện tại chưa có hồ sơ OT. Có thể đặt username và tạo hồ sơ mới.";
    syncUsernameField();
    return;
  }

  activeProfileName.textContent = profile.employee.fullName || profile.username;
  profileHint.textContent = `Dang hien thi duy nhat ho so OT cua account dang nhap tren backend ${API_BASE_URL}. JSON export chi dung de backup thu cong.`;
  syncUsernameField();
}

function renderAll() {
  renderProfileList();
  renderProfileMeta();
  renderTimerPanel();
  renderTable();
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJson() {
  const profile = exportableProfile();
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${profile.username}.ot.json`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSheetName(value) {
  const sanitized = String(value ?? "Trang tinh1")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim();

  return (sanitized || "Trang tinh1").slice(0, 31);
}

function toExcelDateTime(dateText, timeText = "00:00") {
  const normalizedTime = normalizeTime24h(timeText);
  if (!dateText || !normalizedTime) {
    return "";
  }

  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const [hourText, minuteText] = normalizedTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  date.setHours(hour === 24 ? 0 : hour, minute, 0, 0);

  if (hour === 24) {
    date.setDate(date.getDate() + 1);
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00.000`;
}

function buildExcelMarkup(profile) {
  const rows = sortEntries(filteredEntriesForMonth());
  const sheetTitle = escapeXml(sanitizeSheetName(profile.employee.sheetName || "Trang tinh1"));
  const fullName = escapeXml(profile.employee.fullName || profile.username);
  const employeeCode = escapeXml(profile.employee.employeeCode || "");
  const label = escapeXml(profile.employee.label || "DEMO");

  const bodyRows = rows.map((entry) => `
      <Row ss:AutoFitHeight="0" ss:Height="22.5">
        <Cell><Data ss:Type="String">${label}</Data></Cell>
        <Cell><Data ss:Type="String">${employeeCode}</Data></Cell>
        <Cell><Data ss:Type="String">${fullName}</Data></Cell>
        <Cell><Data ss:Type="String"></Data></Cell>
        <Cell ss:StyleID="dateCell"><Data ss:Type="DateTime">${toExcelDateTime(entry.date)}</Data></Cell>
        <Cell ss:StyleID="timeCell"><Data ss:Type="DateTime">${toExcelDateTime(entry.date, entry.startTime)}</Data></Cell>
        <Cell ss:StyleID="timeCell"><Data ss:Type="DateTime">${toExcelDateTime(entry.date, entry.endTime)}</Data></Cell>
        <Cell ss:StyleID="hoursCell" ss:Formula="=MOD(RC[-1]-RC[-2],1)*24"><Data ss:Type="Number">0</Data></Cell>
        <Cell ss:StyleID="reasonCell"><Data ss:Type="String">${escapeXml(entry.note || "")}</Data></Cell>
      </Row>`).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>OT Tracker</Author>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
    <ProtectStructure>False</ProtectStructure>
    <ProtectWindows>False</ProtectWindows>
  </ExcelWorkbook>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Borders/>
      <Font ss:FontName="Arial" ss:Size="10"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="headerBase">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#914D4F"/>
    </Style>
    <Style ss:ID="headerDate" ss:Parent="headerBase">
      <Interior ss:Color="#B7E1CD" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="headerHours" ss:Parent="headerBase">
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#4A86E8"/>
    </Style>
    <Style ss:ID="dateCell">
      <Alignment ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
      <Interior ss:Color="#B7E1CD" ss:Pattern="Solid"/>
      <NumberFormat ss:Format="dd/mm/yyyy"/>
    </Style>
    <Style ss:ID="timeCell">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
      <NumberFormat ss:Format="hh:mm:ss"/>
    </Style>
    <Style ss:ID="hoursCell">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
      <Font ss:FontName="Arial" ss:Size="10" ss:Color="#4A86E8"/>
      <NumberFormat ss:Format="0.##"/>
    </Style>
    <Style ss:ID="reasonCell">
      <Alignment ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${sheetTitle}">
    <Table ss:ExpandedColumnCount="9" ss:ExpandedRowCount="${rows.length + 1}" x:FullColumns="1" x:FullRows="1" ss:DefaultRowHeight="18">
      <Column ss:AutoFitWidth="0" ss:Width="88.5"/>
      <Column ss:AutoFitWidth="0" ss:Width="88.5"/>
      <Column ss:AutoFitWidth="0" ss:Width="116.25"/>
      <Column ss:AutoFitWidth="0" ss:Width="116.25"/>
      <Column ss:AutoFitWidth="0" ss:Width="189.75"/>
      <Column ss:AutoFitWidth="0" ss:Width="88.5"/>
      <Column ss:AutoFitWidth="0" ss:Width="88.5"/>
      <Column ss:AutoFitWidth="0" ss:Width="88.5"/>
      <Column ss:AutoFitWidth="0" ss:Width="483.75"/>
      <Row ss:AutoFitHeight="0" ss:Height="28.5">
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">DEMO</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">MSNV</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">Họ và tên</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String"></Data></Cell>
        <Cell ss:StyleID="headerDate"><Data ss:Type="String">Ngày ghi nhận OT</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">Thời gian vào ca</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">Thời gian ra ca</Data></Cell>
        <Cell ss:StyleID="headerHours"><Data ss:Type="String">Tổng giờ OT</Data></Cell>
        <Cell ss:StyleID="headerBase"><Data ss:Type="String">Giải trình (7,14,21,28)</Data></Cell>
      </Row>${bodyRows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane>
      <ActivePane>2</ActivePane>
      <Panes>
        <Pane>
          <Number>3</Number>
        </Pane>
      </Panes>
      <ProtectObjects>False</ProtectObjects>
      <ProtectScenarios>False</ProtectScenarios>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;
}

function downloadExcel() {
  const profile = exportableProfile();
  const month = getSelectedMonth() || guessMonthForProfile(profile);
  const markup = buildExcelMarkup(profile);
  const blob = new Blob(["\ufeff", markup], {
    type: "application/vnd.ms-excel;charset=utf-8"
  });
  triggerDownload(blob, `${profile.username}-${month}.xls`);
}

async function openMyProfile(options = {}) {
  try {
    const profile = await fetchMyProfileFromApi();
    mergeProfile(profile);
    setActiveUsername(profile.username);
    if (!options.silent) {
      toast(`Đã tải hồ sơ "${profile.username}" thành công.`, "success");
    }
    return true;
  } catch (error) {
    if (!options.silent) {
      if (error.status === 404) {
        toast("Account đăng nhập hiện tại chưa có hồ sơ trên backend. Hãy bấm \"Tạo hồ sơ mới\" nếu cần.", "warning");
      } else {
        toast(error.message, "error");
      }
    }
    return false;
  }
}

async function createProfile(username) {
  const normalized = slugifyUsername(username) || state.suggestedUsername;
  if (!normalized) {
    toast("Nhập username trước khi tạo hồ sơ.", "warning");
    return false;
  }

  try {
    const profile = await createProfileInApi(normalized);
    mergeProfile(profile);
    setActiveUsername(profile.username);
    toast(`Đã tạo hồ sơ "${profile.username}" thành công.`, "success");
    return true;
  } catch (error) {
    if (error.status === 409) {
      return openMyProfile();
    }

    toast(error.message, "error");
    return false;
  }
}

function queueProfileSave() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  syncStateFromEmployeeForm();
  profile.selectedMonth = getSelectedMonth();
  window.clearTimeout(state.profileSaveHandle);
  state.profileSaveHandle = window.setTimeout(async () => {
    try {
      const updatedProfile = await updateProfileInApi(profile);
      mergeProfile(updatedProfile);
      if (state.activeUsername === updatedProfile.username) {
        renderAll();
      }
    } catch (error) {
      console.error(error);
    }
  }, 350);
}

async function saveActiveProfile() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  syncStateFromEmployeeForm();
  profile.selectedMonth = getSelectedMonth();
  const updatedProfile = await updateProfileInApi(profile);
  mergeProfile(updatedProfile);
  if (state.activeUsername === updatedProfile.username) {
    renderAll();
  }
}

async function deleteProfile(username) {
  const normalized = slugifyUsername(username);
  await deleteProfileInApi(normalized);
  removeProfileFromState(normalized);
  exportMonthInput.value = "";
  fillEntryForm();
  syncEmployeeForm();
  renderAll();
}

async function importProfileFromFile(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const targetUsername =
        slugifyUsername(getActiveProfile()?.username) ||
        slugifyUsername(usernameInput.value) ||
        state.suggestedUsername ||
        "my-profile";
      const profile = sanitizeProfile(
        {
          ...parsed,
          username: targetUsername
        },
        targetUsername
      );

      try {
        await createProfileInApi(profile.username);
      } catch (error) {
        if (error.status !== 409) {
          throw error;
        }
      }

      mergeProfile(await updateProfileInApi(profile));

      for (const entry of profile.entries) {
        await createEntryInApi(profile.username, entry);
      }

      await openMyProfile({ silent: true });

      if (profile.activeTimer) {
        toast("Đã import profile và entries. Active timer trong file JSON không được phục hồi vì backend tự quản lý thời điểm start/stop.", "warning");
      } else {
        toast("Import JSON thành công.", "success");
      }
    } catch (error) {
      toast(`Không đọc được file JSON: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      importJsonInput.value = "";
    }
  };
  reader.readAsText(file, "utf8");
}

async function startTimerForActiveProfile() {
  try {
    const profile = requireActiveProfile("bat dau OT");
    profile.activeTimer = await startTimerInApi(profile.username, timerNoteInput.value.trim());
    renderAll();
    toast("Đã bắt đầu bấm giờ OT.", "success");
  } catch (error) {
    toast(formatRequestError(error, "Không bắt đầu được timer."), "error");
  }
}

async function stopTimerForActiveProfile() {
  try {
    const profile = requireActiveProfile("dung va luu OT");
    const timer = getTimer(profile);
    if (!timer) {
      toast("Chưa có timer đang chạy để dừng.", "warning");
      return;
    }

    await stopTimerInApi(profile.username, timerNoteInput.value.trim());
    await openMyProfile({ silent: true });
    fillEntryForm();
    toast("Đã dừng timer và lưu dòng OT mới.", "success");
  } catch (error) {
    toast(formatRequestError(error, "Không dừng được timer."), "error");
  }
}

function queueTimerNoteSave() {
  const profile = getActiveProfile();
  const timer = getTimer(profile);
  if (!profile || !timer) {
    return;
  }

  profile.activeTimer.note = timerNoteInput.value.trim();
  window.clearTimeout(state.timerNoteSaveHandle);
  state.timerNoteSaveHandle = window.setTimeout(async () => {
    try {
      profile.activeTimer = await updateTimerInApi(profile.username, timerNoteInput.value.trim());
      renderTimerPanel();
      renderJsonPreview();
    } catch (error) {
      console.error(error);
    }
  }, 350);
}

async function loadInitialState() {
  logApp("loadInitialState start", {
    href: window.location.href,
    apiBaseUrl: API_BASE_URL
  });
  const session = await requireSession();
  if (!session) {
    logApp("No session returned from requireSession");
    return;
  }

  logApp("Session ready on app page", {
    userId: session.user?.id ?? null,
    email: session.user?.email ?? null
  });
  state.suggestedUsername = getSuggestedUsernameFromSession(session);
  renderAuthSession(session);

  renderAll();

  logApp("Opening profile for signed-in account", {
    suggestedUsername: state.suggestedUsername
  });
  const opened = await openMyProfile({ silent: true });
  if (!opened) {
    renderProfileMeta();
    logApp("No profile found for signed-in account", {
      suggestedUsername: state.suggestedUsername
    });
  }
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await openMyProfile();
});

profileList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-username]");
  if (!button) {
    return;
  }

  await openMyProfile();
});

employeeForm.addEventListener("input", () => {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  syncStateFromEmployeeForm();
  renderProfileMeta();
  renderJsonPreview();
  queueProfileSave();
});

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const normalizedStartTime = entryFields.startTime.value || null;
  const normalizedEndTime = entryFields.endTime.value || null;

  if (!normalizedStartTime || !normalizedEndTime) {
    toast("Vui lòng chọn giờ bắt đầu và kết thúc.", "warning");
    return;
  }

  const entry = {
    id: entryFields.id.value.trim(),
    date: entryFields.date.value,
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
    note: entryFields.note.value.trim()
  };

  if (!entry.date || !entry.startTime || !entry.endTime) {
    return;
  }

  try {
    const profile = requireActiveProfile("luu dong OT");
    if (entry.id) {
      await updateEntryInApi(profile.username, entry.id, entry);
      toast("Đã cập nhật dòng OT thành công.", "success");
    } else {
      await createEntryInApi(profile.username, entry);
      toast("Đã thêm dòng OT mới thành công.", "success");
    }

    await openMyProfile({ silent: true });
    fillEntryForm();
  } catch (error) {
    toast(formatRequestError(error, "Không lưu được dòng OT."), "error");
  }
});


entryTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.classList.contains("edit")) {
    const profile = getActiveProfile();
    const entry = profile?.entries.find((item) => item.id === button.dataset.id);
    if (!entry) {
      return;
    }
    fillEntryForm(entry);
    entryForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (button.classList.contains("delete")) {
    try {
      const profile = requireActiveProfile("xoa dong OT");
      const entry = profile.entries.find((item) => item.id === button.dataset.id);
      if (!entry) {
        toast("Không tìm thấy dòng OT cần xóa trong dữ liệu hiện tại.", "error");
        return;
      }

      if (!toastConfirm(`Xóa dòng OT ngày ${entry.date} (${entry.startTime} – ${entry.endTime})?`)) {
        return;
      }

      await deleteEntryInApi(profile.username, entry.id);
      await openMyProfile({ silent: true });
      fillEntryForm();
      toast("Đã xóa dòng OT thành công.", "success");
    } catch (error) {
      toast(formatRequestError(error, "Không xóa được dòng OT."), "error");
    }
  }
});

timerNoteInput.addEventListener("input", () => {
  queueTimerNoteSave();
});

startTimerButton.addEventListener("click", async () => {
  await startTimerForActiveProfile();
});

stopTimerButton.addEventListener("click", async () => {
  await stopTimerForActiveProfile();
});

saveJsonButton.addEventListener("click", async () => {
  try {
    await saveActiveProfile();
  } catch (error) {
    console.error(error);
  }
  downloadJson();
});

createProfileButton.addEventListener("click", async () => {
  await createProfile(usernameInput.value);
});

deleteProfileButton.addEventListener("click", async () => {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  const confirmed = toastConfirm(`Xóa hồ sơ "${profile.username}" trên backend?`);
  if (!confirmed) {
    return;
  }

  try {
    await deleteProfile(profile.username);
    toast(`Đã xóa hồ sơ "${profile.username}" thành công.`, "success");
  } catch (error) {
    toast(error.message, "error");
  }
});

importJsonButton.addEventListener("click", () => {
  importJsonInput.click();
});

importJsonInput.addEventListener("change", () => {
  void importProfileFromFile(importJsonInput.files?.[0]);
});

resetFormButton.addEventListener("click", () => {
  fillEntryForm();
});

exportMonthInput.addEventListener("change", async () => {
  const profile = getActiveProfile();
  if (!profile) {
    renderStats();
    return;
  }

  profile.selectedMonth = getSelectedMonth();
  renderStats();
  renderJsonPreview();

  try {
    await saveActiveProfile();
  } catch (error) {
    console.error(error);
  }
});

exportButton.addEventListener("click", async () => {
  try {
    await saveActiveProfile();
  } catch (error) {
    console.error(error);
  }
  downloadExcel();
});

setupTimePickers();
void loadInitialState();
window.setInterval(() => {
  if (getTimer()) {
    renderTimerPanel();
  }
}, 1000);

signOutButton.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    window.location.href = loginPageLink.href;
  }
});
