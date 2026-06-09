import {
  getAccessToken,
  getAuthConfig,
  getUserSnapshot,
  replayPersistedDebugLogs,
  refreshSession,
  requireSession,
  signOut,
} from "./auth.js";
import {
  createBlankProfile,
  formatDateInputValue,
  formatDateTimeDisplay,
  formatDurationMinutes,
  formatTimeInputValue,
  getEntriesForMonth,
  getWeekdayLabel,
  minutesBetween,
  normalizeSheetName,
  normalizeTime24h,
  pad,
  sanitizeProfile,
  sanitizeTimer,
  slugifyUsername,
  splitEntriesAcrossMidnight,
  splitEntryAcrossMidnight,
} from "./domain.js";
import { createOtApiClient, mergeProfilesByUsername } from "./ot-api.js";
import {
  createAdminOtExportWorkbook,
  createOtExportWorkbook,
} from "./ot-export.js";
import { toast, toastConfirm } from "./ui-feedback.js";

const API_BASE_URL = getAuthConfig().apiBaseUrl;
const APP_LOG_PREFIX = "[OT App]";

function logApp(step, detail) {
  void step;
  void detail;
}

function logApi(step, detail) {
  void step;
  void detail;
}

const otApi = createOtApiClient({
  apiBaseUrl: API_BASE_URL,
  getAccessToken,
  refreshSession,
  onUnauthorized: () => {
    window.location.href = loginPageLink.href;
  },
  logApi,
});

function formatRequestError(error, fallbackMessage = "Request failed.") {
  if (!error) {
    return fallbackMessage;
  }

  const statusText = error.status ? ` [HTTP ${error.status}]` : "";
  const message = error.message
    ? String(error.message).trim()
    : fallbackMessage;
  return `${message}${statusText}`;
}

replayPersistedDebugLogs("app page");

const state = {
  suggestedUsername: "",
  activeUsername: "",
  currentUserMeta: null,
  profiles: {},
  admin: {
    members: [],
    profiles: [],
    viewMode: "member",
    selectedUsername: "",
    month: "",
  },
  timerNoteSaveHandle: 0,
  loading: {
    savingEntry: false,
    adminExporting: false,
    adminLoading: false,
    deletingEntryIds: new Set(),
    deletingProfileUsername: "",
    creatingProfile: false,
    updatingEmployee: false,
    stoppingTimer: false,
  },
};

const profileForm = document.querySelector("#profileForm");
const usernameInput = document.querySelector("#usernameInput");
const employeeForm = document.querySelector("#employeeForm");
const employeeUpdateButton = document.querySelector("#employeeUpdateButton");
const entryForm = document.querySelector("#entryForm");
const entryFormOverlay = document.querySelector("#entryFormOverlay");
const entryFormOverlayText = document.querySelector("#entryFormOverlayText");
const exportMonthInput = document.querySelector("#exportMonth");
const profileList = document.querySelector("#profileList");
const entryTableBody = document.querySelector("#entryTableBody");
const saveJsonButton = document.querySelector("#saveJsonButton");
const exportButton = document.querySelector("#exportButton");
const adminExportButton = document.querySelector("#adminExportButton");
const adminPanel = document.querySelector("#adminPanel");
const adminViewMode = document.querySelector("#adminViewMode");
const adminMemberField = document.querySelector("#adminMemberField");
const adminMemberSelect = document.querySelector("#adminMemberSelect");
const adminMonthInput = document.querySelector("#adminMonth");
const adminLoadButton = document.querySelector("#adminLoadButton");
const adminViewTitle = document.querySelector("#adminViewTitle");
const adminViewHint = document.querySelector("#adminViewHint");
const adminMemberCount = document.querySelector("#adminMemberCount");
const adminEntryCount = document.querySelector("#adminEntryCount");
const adminTotalHours = document.querySelector("#adminTotalHours");
const adminEntryTableBody = document.querySelector("#adminEntryTableBody");
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
const themeToggle = document.querySelector("#themeToggle");
const themeToggleThumb = themeToggle.querySelector(".theme-toggle-thumb");
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
  sheetName: employeeForm.elements.namedItem("sheetName"),
};
const entryFields = {
  id: entryForm.elements.namedItem("id"),
  date: entryForm.elements.namedItem("date"),
  startTime: entryForm.elements.namedItem("startTime"),
  endTime: entryForm.elements.namedItem("endTime"),
  note: entryForm.elements.namedItem("note"),
};
const timePickerRoots = Array.from(
  document.querySelectorAll("[data-time-picker]"),
);
const timePickerState = {
  activeRoot: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mergeProfile(profile) {
  const normalizedProfile = sanitizeProfile(profile, profile?.username);
  state.profiles = {
    [normalizedProfile.username]: normalizedProfile,
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

function isSavingEntry() {
  return state.loading.savingEntry;
}

function isDeletingEntry(entryId) {
  return state.loading.deletingEntryIds.has(String(entryId ?? "").trim());
}

function isDeletingProfile(username) {
  return (
    slugifyUsername(username) !== "" &&
    state.loading.deletingProfileUsername === slugifyUsername(username)
  );
}

function isCreatingProfile() {
  return state.loading.creatingProfile;
}

function isUpdatingEmployee() {
  return state.loading.updatingEmployee;
}

function isAdminExporting() {
  return state.loading.adminExporting;
}

function isAdminLoading() {
  return state.loading.adminLoading;
}

function getCurrentUserRole() {
  const meta = state.currentUserMeta ?? {};
  const role =
    meta.profile?.role ??
    meta.role ??
    meta.user?.role ??
    meta.member?.role ??
    meta.account?.role ??
    "";
  return String(role).trim().toUpperCase();
}

function isCurrentUserAdmin() {
  return getCurrentUserRole() === "ADMIN";
}

function isStoppingTimer() {
  return state.loading.stoppingTimer;
}

function setSavingEntry(isLoading, label = "Đang lưu dòng OT...") {
  state.loading.savingEntry = Boolean(isLoading);
  if (entryFormOverlay) {
    entryFormOverlay.hidden = !state.loading.savingEntry;
  }
  if (entryFormOverlayText) {
    entryFormOverlayText.textContent = label;
  }
  renderEntryFormState();
}

function setDeletingEntry(entryId, isLoading) {
  const normalizedId = String(entryId ?? "").trim();
  if (!normalizedId) {
    return;
  }

  if (isLoading) {
    state.loading.deletingEntryIds.add(normalizedId);
  } else {
    state.loading.deletingEntryIds.delete(normalizedId);
  }

  renderTable();
}

function setDeletingProfile(username, isLoading) {
  state.loading.deletingProfileUsername = isLoading
    ? slugifyUsername(username)
    : "";
  renderProfileList();
  renderProfileMeta();
  renderProfileActions();
}

function setCreatingProfile(isLoading) {
  state.loading.creatingProfile = Boolean(isLoading);
  renderProfileActions();
}

function setUpdatingEmployee(isLoading) {
  state.loading.updatingEmployee = Boolean(isLoading);
  renderEmployeeFormState();
}

function setAdminExporting(isLoading) {
  state.loading.adminExporting = Boolean(isLoading);
  renderAdminExportAction();
}

function setAdminLoading(isLoading) {
  state.loading.adminLoading = Boolean(isLoading);
  renderAdminPanel();
}

function setStoppingTimer(isLoading) {
  state.loading.stoppingTimer = Boolean(isLoading);
  renderTimerPanel();
}

function requireActiveProfile(actionLabel = "thuc hien thao tac nay") {
  const profile = getActiveProfile();
  if (!profile) {
    throw new Error(
      `Chua mo duoc ho so OT cua account hien tai, nen khong the ${actionLabel}. Hay bam "Tai ho so cua toi" truoc.`,
    );
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
  const firstEntry = [...(profile?.entries ?? [])].sort((left, right) =>
    `${left.date} ${left.startTime}`.localeCompare(
      `${right.date} ${right.startTime}`,
    ),
  )[0];

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
    note: String(timer.note ?? "").trim(),
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
    minute: Number(minuteText),
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
    const selected = isHourOption
      ? optionValue === selectedHour
      : optionValue === selectedMinute;
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
      block: "nearest",
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
  root.classList.remove("time-picker--drop-up");
  popover.style.removeProperty("--time-picker-list-max-height");

  if (timePickerState.activeRoot === root) {
    timePickerState.activeRoot = null;
  }
}

function closeAllTimePickers() {
  timePickerRoots.forEach((root) => {
    closeTimePicker(root);
  });
}

function positionTimePicker(root) {
  if (!root) {
    return;
  }

  const input = root.querySelector(".time-picker-input");
  const popover = root.querySelector("[data-time-popover]");
  const viewportPadding = 16;
  const gap = 10;

  root.classList.remove("time-picker--drop-up");
  popover.style.removeProperty("--time-picker-list-max-height");

  const inputRect = input.getBoundingClientRect();
  const estimatedPopoverHeight = Math.min(
    360,
    window.innerHeight - viewportPadding * 2,
  );
  const spaceBelow = window.innerHeight - inputRect.bottom - viewportPadding;
  const spaceAbove = inputRect.top - viewportPadding;
  const shouldDropUp =
    spaceBelow < estimatedPopoverHeight && spaceAbove > spaceBelow;
  const availableSpace = Math.max(
    180,
    (shouldDropUp ? spaceAbove : spaceBelow) - gap,
  );
  const listMaxHeight = Math.max(120, Math.floor(availableSpace - 70));

  if (shouldDropUp) {
    root.classList.add("time-picker--drop-up");
  }

  popover.style.setProperty(
    "--time-picker-list-max-height",
    `${listMaxHeight}px`,
  );
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
  positionTimePicker(root);
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
    updateTimeInputValue(
      input,
      nextValue,
      nextValue === 24 ? 0 : currentParts.minute,
    );
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
      }
    });

    input.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      openTimePicker(root);
    });

    input.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        openTimePicker(root);
      }

      if (event.key === "Escape") {
        closeTimePicker(root);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (
      timePickerState.activeRoot &&
      !timePickerState.activeRoot.contains(event.target)
    ) {
      closeTimePicker(timePickerState.activeRoot);
    }
  });

  window.addEventListener("resize", () => {
    if (timePickerState.activeRoot) {
      positionTimePicker(timePickerState.activeRoot);
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (timePickerState.activeRoot) {
        positionTimePicker(timePickerState.activeRoot);
      }
    },
    { passive: true },
  );

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
    sheetName: normalizeSheetName(employeeFields.sheetName.value),
  };
}

function getRequiredFullNameForProfileCreation() {
  const fullName = employeeFields.fullName.value.trim();
  employeeFields.fullName.setCustomValidity(
    fullName ? "" : "Vui lòng nhập họ và tên trước khi tạo hồ sơ OT.",
  );
  if (!fullName) {
    employeeFields.fullName.reportValidity();
    employeeFields.fullName.focus();
    toast("Nhập họ và tên trước khi tạo hồ sơ OT.", "warning");
    return "";
  }

  return fullName;
}

function serializeProfile(profile) {
  return {
    username: profile.username,
    selectedMonth: profile.selectedMonth,
    employee: {
      label: profile.employee.label,
      employeeCode: profile.employee.employeeCode,
      fullName: profile.employee.fullName,
      sheetName: profile.employee.sheetName,
    },
    activeTimer: profile.activeTimer
      ? {
          startedAt: profile.activeTimer.startedAt,
          note: profile.activeTimer.note,
        }
      : null,
    entries: profile.entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      note: entry.note,
    })),
  };
}

function exportableProfile(profile = getActiveProfile()) {
  return profile
    ? serializeProfile(sanitizeProfile(profile, state.activeUsername))
    : createBlankProfile();
}

function sortEntries(entries) {
  return [...entries].sort((left, right) =>
    `${left.date} ${left.startTime}`.localeCompare(
      `${right.date} ${right.startTime}`,
    ),
  );
}

function getInitials(displayName, email) {
  const name = displayName || email || "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getSuggestedUsernameFromSession(session) {
  const user = getUserSnapshot(session);
  const emailPrefix = user.email.includes("@")
    ? user.email.split("@")[0]
    : user.email;
  return (
    slugifyUsername(emailPrefix || user.displayName || user.id) || "my-profile"
  );
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

function renderAdminExportAction() {
  if (!adminExportButton) {
    return;
  }

  const isAdmin = isCurrentUserAdmin();
  const isExporting = isAdminExporting();
  const isAllMode = isAdmin && state.admin.viewMode === "all";
  const hasExportSource =
    state.admin.profiles.length > 0 || state.admin.members.length > 0;
  adminExportButton.hidden = !isAllMode;
  adminExportButton.disabled =
    !isAllMode ||
    isExporting ||
    isAdminLoading() ||
    !hasExportSource;
  adminExportButton.innerHTML = isExporting
    ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang xuất toàn bộ...</span>'
    : "Xuất Excel toàn bộ";
}

async function fetchCurrentUserMeta() {
  state.currentUserMeta = await otApi.fetchCurrentUserMeta();
  renderAdminExportAction();
  return state.currentUserMeta;
}

async function fetchAdminMembersFromApi() {
  return otApi.fetchAdminMembers();
}

function getAdminMemberUsernames() {
  return [
    ...new Set(
      state.admin.members
        .map((member) => slugifyUsername(member?.username))
        .filter(Boolean),
    ),
  ];
}

async function ensureAdminMembersLoaded() {
  if (!isCurrentUserAdmin() || state.admin.members.length > 0) {
    return;
  }

  state.admin.members = await fetchAdminMembersFromApi();
}

async function fetchAdminOtDataFromApi(month = "") {
  return otApi.fetchAdminOtData(month);
}

function getAdminVisibleProfiles() {
  if (state.admin.viewMode === "all") {
    return state.admin.profiles;
  }

  return state.admin.profiles.filter(
    (profile) => profile.username === state.admin.selectedUsername,
  );
}

function getAdminVisibleRows() {
  return getAdminVisibleProfiles().flatMap((profile) =>
    sortEntries(getEntriesForMonth(profile.entries, state.admin.month)).map(
      (entry) => ({
        profile,
        entry,
      }),
    ),
  );
}

async function fetchMyProfileFromApi() {
  const username =
    slugifyUsername(getActiveProfile()?.username) ||
    slugifyUsername(usernameInput.value) ||
    state.suggestedUsername;

  return otApi.fetchMyProfile(username, username || state.suggestedUsername);
}

async function fetchProfileByUsernameFromApi(username) {
  return otApi.fetchProfileByUsername(username);
}

async function fetchAdminProfileByUsernameFromApi(username) {
  return otApi.fetchAdminProfileByUsername(username);
}

async function fetchExpandedAdminProfiles(month = "") {
  await ensureAdminMembersLoaded();

  const payload = await fetchAdminOtDataFromApi(month);
  let profiles = mergeProfilesByUsername(payload.profiles);
  const memberUsernames = getAdminMemberUsernames();

  if (profiles.length <= 1 && memberUsernames.length > profiles.length) {
    const fetchedProfiles = (
      await Promise.all(
        memberUsernames.map(async (username) => {
          try {
            return await fetchAdminProfileByUsernameFromApi(username);
          } catch (error) {
            console.error("[OT API] Admin profile fallback failed", {
              username,
              error,
            });
            return null;
          }
        }),
      )
    ).filter(Boolean);

    profiles = mergeProfilesByUsername(profiles, fetchedProfiles);
  }

  return profiles.map((profile) => ({
    ...profile,
    entries: getEntriesForMonth(profile.entries, month),
  }));
}

async function createProfileInApi(username) {
  return otApi.createProfile(username);
}

async function updateProfileInApi(profile) {
  return otApi.updateProfile(profile);
}

async function updateEmployeeProfileInApi(profile) {
  return otApi.updateEmployeeProfile(profile.employee, profile.username);
}

async function deleteProfileInApi(username) {
  await otApi.deleteProfile(username);
}

async function createEntryInApi(username, entry) {
  return otApi.createEntry(username, entry);
}

async function updateEntryInApi(username, entryId, entry) {
  return otApi.updateEntry(username, entryId, entry);
}

async function deleteEntryInApi(username, entryId) {
  await otApi.deleteEntry(username, entryId);
}

async function startTimerInApi(username, note) {
  return otApi.startTimer(username, note);
}

async function updateTimerInApi(username, note) {
  return otApi.updateTimer(username, note);
}

async function stopTimerInApi(username, note) {
  return otApi.stopTimer(username, note);
}

async function downloadAdminOtExport(options = {}) {
  void options;
  if (!window.ExcelJS?.Workbook) {
    toast(
      "Thiếu thư viện export .xlsx. Hãy tải lại trang rồi thử lại.",
      "error",
    );
    return;
  }

  let profiles = [];

  if (state.admin.viewMode === "all") {
    profiles = await fetchExpandedAdminProfiles(state.admin.month);
  } else {
    profiles = getAdminVisibleProfiles();

    if (profiles.length === 0) {
      const payload = await fetchAdminOtDataFromApi(state.admin.month);
      profiles = payload.profiles.filter(
        (profile) => profile.username === state.admin.selectedUsername,
      );
    }
  }

  if (state.admin.viewMode === "all" && profiles.length > 0) {
    state.admin.profiles = profiles;
    renderAdminPanel();
  }

  if (profiles.length === 0) {
    toast("Không có dữ liệu thành viên để xuất Excel.", "warning");
    return;
  }

  const entryCount = profiles.reduce(
    (count, profile) =>
      count + getEntriesForMonth(profile.entries, state.admin.month).length,
    0,
  );
  if (entryCount === 0) {
    const monthText = state.admin.month ? ` trong tháng ${state.admin.month}` : "";
    toast(`Không có dữ liệu OT${monthText} để xuất Excel.`, "warning");
    return;
  }

  const workbook = createAdminOtExportWorkbook(profiles, {
    month: state.admin.month,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const monthSuffix = state.admin.month ? `-${state.admin.month}` : "";
  triggerDownload(blob, `otworker-all-members${monthSuffix}.xlsx`);
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
  if (isDeletingProfile(profile.username)) {
    button.classList.add("is-loading");
    button.disabled = true;
    button.innerHTML = `
      <span class="profile-chip-status">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>Đang xóa ${escapeHtml(profile.username)}</span>
      </span>
    `;
  } else {
    button.textContent = profile.username;
  }
  profileList.append(button);
}

function renderProfileActions() {
  const profile = getActiveProfile();
  const isProfileDeleting = isDeletingProfile(profile?.username);
  const isProfileCreating = isCreatingProfile();
  deleteProfileButton.disabled =
    !profile || isProfileDeleting || isProfileCreating;
  createProfileButton.disabled = isProfileDeleting || isProfileCreating;

  if (isProfileDeleting) {
    deleteProfileButton.innerHTML = `
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>Đang xóa hồ sơ...</span>
    `;
    return;
  }

  deleteProfileButton.textContent = "Xóa hồ sơ";

  createProfileButton.innerHTML = isProfileCreating
    ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang tạo hồ sơ...</span>'
    : "Tạo hồ sơ cho account này";
}

function renderEmployeeFormState() {
  const isBusy = isUpdatingEmployee();
  const hasProfile = Boolean(getActiveProfile());
  employeeForm.classList.toggle("is-busy", isBusy);

  Object.values(employeeFields).forEach((field) => {
    field.disabled = isBusy;
  });

  if (employeeUpdateButton) {
    employeeUpdateButton.disabled = !hasProfile || isBusy;
    employeeUpdateButton.innerHTML = isBusy
      ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang cập nhật...</span>'
      : "Cập nhật thông tin";
  }
}

function renderStats() {
  const entriesForMonth = filteredEntriesForMonth();
  entryCount.textContent = String(entriesForMonth.length);
  const totalMinutes = entriesForMonth.reduce(
    (sum, entry) => sum + minutesBetween(entry.startTime, entry.endTime),
    0,
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
  const isTimerStopping = isStoppingTimer();

  timerNoteInput.disabled = !hasProfile || isTimerStopping;
  startTimerButton.disabled = !hasProfile || Boolean(timer) || isTimerStopping;
  stopTimerButton.disabled = !timer || isTimerStopping;
  stopTimerButton.innerHTML = isTimerStopping
    ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang dừng và lưu OT...</span>'
    : "Dừng và lưu OT";

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

  if (isTimerStopping) {
    timerStatus.textContent = `Đang dừng timer và lưu OT cho hồ sơ "${profile.username}"...`;
  }

  if (!isTimerStopping) {
    timerStatus.textContent = `Đang bấm giờ cho hồ sơ "${profile.username}". Khi dừng, backend sẽ tạo dòng OT mới.`;
  }
  timerStartedAt.textContent = formatDateTimeDisplay(timer.startedAt);
  timerElapsed.textContent = formatDurationMinutes(
    getTimerDurationMinutes(timer),
  );
  if (
    document.activeElement !== timerNoteInput &&
    timerNoteInput.value !== (timer.note ?? "")
  ) {
    timerNoteInput.value = timer.note ?? "";
  }
}

function renderEntryFormState() {
  const isBusy = isSavingEntry();
  entryForm.classList.toggle("is-busy", isBusy);
  entryFields.date.disabled = isBusy;
  entryFields.note.disabled = isBusy;
  entryFields.startTime.disabled = isBusy;
  entryFields.endTime.disabled = isBusy;
  resetFormButton.disabled = isBusy;

  const submitButton = entryForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = isBusy;
    submitButton.innerHTML = isBusy
      ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang lưu dòng OT...</span>'
      : "Lưu dòng OT";
  }

  timePickerRoots.forEach((root) => {
    root.classList.toggle("is-disabled", isBusy);
  });

  if (isBusy) {
    closeAllTimePickers();
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

  const fragment = document.createDocumentFragment();
  rows.forEach((entry) => {
    const isRowDeleting = isDeletingEntry(entry.id);
    const weekdayLabel = getWeekdayLabel(entry.date);
    const tr = document.createElement("tr");
    tr.classList.toggle("is-loading", isRowDeleting);
    tr.innerHTML = `
      <td>
        <span class="row-status row-status--date">
          ${isRowDeleting ? '<span class="loading-spinner" aria-hidden="true"></span>' : ""}
          <span class="date-stack">
            ${weekdayLabel ? `<span class="weekday-badge">${escapeHtml(weekdayLabel)}</span>` : ""}
            <span class="date-value">${escapeHtml(entry.date)}</span>
          </span>
        </span>
      </td>
      <td>${entry.startTime}</td>
      <td>${entry.endTime}</td>
      <td><span class="hours-badge">${formatDurationMinutes(minutesBetween(entry.startTime, entry.endTime))}</span></td>
      <td>${escapeHtml(entry.note || "")}</td>
      <td>
        <div class="row-actions">
          <button class="edit" data-id="${entry.id}" type="button" ${isRowDeleting ? "disabled" : ""}>
            <span class="row-action-label">✎ Sửa</span>
          </button>
          <button class="delete" data-id="${entry.id}" type="button" ${isRowDeleting ? "disabled" : ""}>
            <span class="row-action-label">${isRowDeleting ? "…" : "⌫"} Xóa</span>
          </button>
        </div>
      </td>
    `;
    fragment.append(tr);
  });
  entryTableBody.append(fragment);

  renderStats();
  renderJsonPreview();
}

function renderProfileMeta() {
  const profile = getActiveProfile();
  if (!profile) {
    activeProfileName.textContent = "Chưa có hồ sơ";
    profileHint.textContent =
      "Account đang nhập hiện tại chưa có hồ sơ OT. Có thể đặt username và tạo hồ sơ mới.";
    syncUsernameField();
    return;
  }

  activeProfileName.textContent = profile.employee.fullName || profile.username;
  profileHint.textContent = `Dang hien thi duy nhat ho so OT cua account dang nhap tren backend ${API_BASE_URL}. JSON export chi dung de backup thu cong.`;
  syncUsernameField();
}

function renderAdminMemberOptions() {
  if (!adminMemberSelect) {
    return;
  }

  const currentValue = state.admin.selectedUsername;
  adminMemberSelect.innerHTML = "";

  if (state.admin.members.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = isAdminLoading()
      ? "Đang tải danh sách..."
      : "Chưa có thành viên";
    adminMemberSelect.append(option);
    return;
  }

  state.admin.members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.username;
    const employeeName = String(member.employee?.fullName ?? "").trim();
    option.textContent = employeeName
      ? `${employeeName} (${member.username})`
      : member.username;
    adminMemberSelect.append(option);
  });

  if (
    currentValue &&
    state.admin.members.some((member) => member.username === currentValue)
  ) {
    adminMemberSelect.value = currentValue;
  } else {
    state.admin.selectedUsername = adminMemberSelect.value;
  }
}

function renderAdminTable() {
  if (!adminEntryTableBody) {
    return;
  }

  const rows = getAdminVisibleRows();
  adminEntryTableBody.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const modeLabel =
      state.admin.viewMode === "all"
        ? "toàn bộ thành viên"
        : "thành viên đã chọn";
    tr.innerHTML = `<td colspan="7" class="empty">Chưa có dữ liệu OT cho ${modeLabel}.</td>`;
    adminEntryTableBody.append(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach(({ profile, entry }) => {
    const employee = profile.employee ?? {};
    const displayName = employee.fullName || profile.username;
    const weekdayLabel = getWeekdayLabel(entry.date);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(displayName)}</td>
      <td>${escapeHtml(employee.employeeCode || "")}</td>
      <td>
        <span class="date-stack">
          ${weekdayLabel ? `<span class="weekday-badge">${escapeHtml(weekdayLabel)}</span>` : ""}
          <span class="date-value">${escapeHtml(entry.date)}</span>
        </span>
      </td>
      <td>${escapeHtml(entry.startTime)}</td>
      <td>${escapeHtml(entry.endTime)}</td>
      <td><span class="hours-badge">${formatDurationMinutes(minutesBetween(entry.startTime, entry.endTime))}</span></td>
      <td>${escapeHtml(entry.note || "")}</td>
    `;
    fragment.append(tr);
  });
  adminEntryTableBody.append(fragment);
}

function renderAdminSummary() {
  const profiles = getAdminVisibleProfiles();
  const rows = getAdminVisibleRows();
  const totalMinutes = rows.reduce(
    (sum, { entry }) => sum + minutesBetween(entry.startTime, entry.endTime),
    0,
  );

  if (adminMemberCount) {
    adminMemberCount.textContent = String(profiles.length);
  }
  if (adminEntryCount) {
    adminEntryCount.textContent = String(rows.length);
  }
  if (adminTotalHours) {
    adminTotalHours.textContent = formatDurationMinutes(totalMinutes);
  }

  if (!adminViewTitle || !adminViewHint) {
    return;
  }

  if (!isCurrentUserAdmin()) {
    adminViewTitle.textContent = "Không có quyền ADMIN";
    adminViewHint.textContent = "Khu vực này chỉ hiển thị cho account ADMIN.";
    return;
  }

  if (state.admin.viewMode === "all") {
    adminViewTitle.textContent = "Đang xem toàn bộ thành viên";
    adminViewHint.textContent =
      state.admin.profiles.length > 0
        ? "Dữ liệu được lấy từ /api/admin/ot-data. Nút xuất Excel toàn bộ chỉ hiển thị trong chế độ này."
        : "Bấm Xem OT để tải dữ liệu toàn bộ thành viên.";
    return;
  }

  const profile = profiles[0];
  if (!profile) {
    adminViewTitle.textContent = "Chưa chọn thành viên";
    adminViewHint.textContent = "Chọn một thành viên rồi bấm Xem OT.";
    return;
  }

  adminViewTitle.textContent = profile.employee.fullName || profile.username;
  adminViewHint.textContent = `ADMIN đang xem hồ sơ OT "${profile.username}" ở chế độ chỉ đọc.`;
}

function renderAdminPanel() {
  if (!adminPanel) {
    return;
  }

  const isAdmin = isCurrentUserAdmin();
  adminPanel.hidden = !isAdmin;
  if (!isAdmin) {
    return;
  }

  if (adminViewMode) {
    adminViewMode.value = state.admin.viewMode;
    adminViewMode.disabled = isAdminLoading() || isAdminExporting();
  }
  if (adminMemberField) {
    adminMemberField.hidden = state.admin.viewMode === "all";
  }
  if (adminMemberSelect) {
    adminMemberSelect.disabled =
      state.admin.viewMode === "all" || isAdminLoading() || isAdminExporting();
  }
  if (adminMonthInput) {
    adminMonthInput.value = state.admin.month;
    adminMonthInput.disabled = isAdminLoading() || isAdminExporting();
  }
  if (adminLoadButton) {
    adminLoadButton.disabled =
      isAdminLoading() ||
      isAdminExporting() ||
      (state.admin.viewMode === "member" && !state.admin.selectedUsername);
    adminLoadButton.innerHTML = isAdminLoading()
      ? '<span class="loading-spinner" aria-hidden="true"></span><span>Đang tải OT...</span>'
      : "Xem OT";
  }

  renderAdminMemberOptions();
  renderAdminSummary();
  renderAdminTable();
  renderAdminExportAction();
}

function renderAll() {
  renderProfileList();
  renderProfileMeta();
  renderProfileActions();
  renderEmployeeFormState();
  renderAdminPanel();
  renderAdminExportAction();
  renderEntryFormState();
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
  const blob = new Blob([JSON.stringify(profile, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `${profile.username}.ot.json`);
}

async function downloadExcel() {
  const currentProfile = requireActiveProfile("xuat Excel");
  const month = getSelectedMonth() || guessMonthForProfile(currentProfile);
  const latestProfile = await fetchMyProfileFromApi();
  const refreshedProfile = mergeProfile(latestProfile);
  if (month) {
    refreshedProfile.selectedMonth = month;
  }
  setActiveUsername(refreshedProfile.username);
  if (month) {
    exportMonthInput.value = month;
  }
  const profile = exportableProfile(refreshedProfile);
  const exportRecords = splitEntriesAcrossMidnight(profile.entries).filter(
    (entry) => entry.date.startsWith(month),
  );

  if (!window.ExcelJS?.Workbook) {
    toast(
      "Thiếu thư viện export .xlsx. Hãy tải lại trang rồi thử lại.",
      "error",
    );
    return;
  }

  if (exportRecords.length === 0) {
    toast(
      `Không có dữ liệu OT trong tháng ${month} để xuất Excel.`,
      "warning",
    );
    return;
  }

  const workbook = createOtExportWorkbook(exportRecords, profile.employee);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${profile.username}-${month}.xlsx`);
}

async function loadAdminMembers() {
  if (!isCurrentUserAdmin()) {
    return;
  }

  try {
    setAdminLoading(true);
    state.admin.members = await fetchAdminMembersFromApi();
    if (
      !state.admin.selectedUsername ||
      !state.admin.members.some(
        (member) => member.username === state.admin.selectedUsername,
      )
    ) {
      state.admin.selectedUsername = state.admin.members[0]?.username || "";
    }
  } catch (error) {
    toast(
      formatRequestError(error, "Không tải được danh sách thành viên."),
      "error",
    );
  } finally {
    setAdminLoading(false);
  }
}

async function loadAdminOtData() {
  if (!isCurrentUserAdmin()) {
    return;
  }

  if (state.admin.viewMode === "member" && !state.admin.selectedUsername) {
    toast("Chọn thành viên trước khi xem OT.", "warning");
    return;
  }

  try {
    setAdminLoading(true);
    if (state.admin.viewMode === "all") {
      state.admin.profiles = await fetchExpandedAdminProfiles(
        state.admin.month,
      );
    } else {
      const { profiles } = await fetchAdminOtDataFromApi(state.admin.month);
      state.admin.profiles = profiles.filter(
        (profile) => profile.username === state.admin.selectedUsername,
      );
    }
    renderAdminPanel();
  } catch (error) {
    toast(
      formatRequestError(error, "Không tải được dữ liệu OT ADMIN."),
      "error",
    );
  } finally {
    setAdminLoading(false);
  }
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
        toast(
          'Account đăng nhập hiện tại chưa có hồ sơ trên backend. Hãy bấm "Tạo hồ sơ mới" nếu cần.',
          "warning",
        );
      } else {
        toast(error.message, "error");
      }
    }
    return false;
  }
}

async function createProfile(username, fullName) {
  const normalized = slugifyUsername(username) || state.suggestedUsername;
  if (!normalized) {
    toast("Nhập username trước khi tạo hồ sơ.", "warning");
    return false;
  }

  try {
    setCreatingProfile(true);
    const profile = await createProfileInApi(normalized);
    profile.employee.fullName = fullName;
    const updatedProfile = await updateProfileInApi(profile);
    mergeProfile(updatedProfile);
    setActiveUsername(updatedProfile.username);
    toast(`Đã tạo hồ sơ "${updatedProfile.username}" thành công.`, "success");
    return true;
  } catch (error) {
    if (error.status === 409) {
      return openMyProfile();
    }

    toast(error.message, "error");
    return false;
  } finally {
    setCreatingProfile(false);
  }
}

async function updateEmployeeForActiveProfile() {
  if (isUpdatingEmployee()) {
    return;
  }

  if (!employeeForm.reportValidity()) {
    return;
  }

  try {
    const profile = requireActiveProfile("cap nhat thong tin nhan su");
    setUpdatingEmployee(true);
    syncStateFromEmployeeForm();
    const updatedProfile = await updateEmployeeProfileInApi(profile);
    mergeProfile(updatedProfile);
    if (state.activeUsername === updatedProfile.username) {
      renderAll();
    }
    toast("Đã cập nhật thông tin nhân sự thành công.", "success");
  } catch (error) {
    if (error.status === 409) {
      await openMyProfile({ silent: true });
      toast(
        "Hồ sơ vừa được cập nhật ở nơi khác. Mình đã tải lại dữ liệu mới nhất, bạn kiểm tra rồi bấm cập nhật lại nhé.",
        "warning",
      );
      return;
    }

    toast(
      formatRequestError(error, "Không cập nhật được thông tin nhân sự."),
      "error",
    );
  } finally {
    setUpdatingEmployee(false);
  }
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
          username: targetUsername,
        },
        targetUsername,
      );

      try {
        await createProfileInApi(profile.username);
      } catch (error) {
        if (error.status !== 409) {
          throw error;
        }
      }

      mergeProfile(await updateProfileInApi(profile));

      for (const entry of splitEntriesAcrossMidnight(profile.entries)) {
        await createEntryInApi(profile.username, entry);
      }

      await openMyProfile({ silent: true });

      if (profile.activeTimer) {
        toast(
          "Đã import profile và entries. Active timer trong file JSON không được phục hồi vì backend tự quản lý thời điểm start/stop.",
          "warning",
        );
      } else {
        toast("Import JSON thành công.", "success");
      }
    } catch (error) {
      toast(
        `Không đọc được file JSON: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      importJsonInput.value = "";
    }
  };
  reader.readAsText(file, "utf8");
}

async function startTimerForActiveProfile() {
  try {
    const profile = requireActiveProfile("bat dau OT");
    profile.activeTimer = await startTimerInApi(
      profile.username,
      timerNoteInput.value.trim(),
    );
    renderAll();
    toast("Đã bắt đầu bấm giờ OT.", "success");
  } catch (error) {
    toast(formatRequestError(error, "Không bắt đầu được timer."), "error");
  }
}

async function stopTimerForActiveProfile() {
  if (isStoppingTimer()) {
    return;
  }

  try {
    const profile = requireActiveProfile("dung va luu OT");
    const timer = getTimer(profile);
    if (!timer) {
      toast("Chưa có timer đang chạy để dừng.", "warning");
      return;
    }

    setStoppingTimer(true);
    await stopTimerInApi(profile.username, timerNoteInput.value.trim());
    await openMyProfile({ silent: true });
    fillEntryForm();
    toast("Đã dừng timer và lưu dòng OT mới.", "success");
  } catch (error) {
    toast(formatRequestError(error, "Không dừng được timer."), "error");
  } finally {
    setStoppingTimer(false);
  }
}

function queueTimerNoteSave() {
  const profile = getActiveProfile();
  const timer = getTimer(profile);
  if (!profile || !timer || isStoppingTimer()) {
    return;
  }

  profile.activeTimer.note = timerNoteInput.value.trim();
  window.clearTimeout(state.timerNoteSaveHandle);
  state.timerNoteSaveHandle = window.setTimeout(async () => {
    try {
      profile.activeTimer = await updateTimerInApi(
        profile.username,
        timerNoteInput.value.trim(),
      );
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
    apiBaseUrl: API_BASE_URL,
  });
  const session = await requireSession();
  if (!session) {
    logApp("No session returned from requireSession");
    return;
  }

  logApp("Session ready on app page", {
    userId: session.user?.id ?? null,
    email: session.user?.email ?? null,
  });
  state.suggestedUsername = getSuggestedUsernameFromSession(session);
  renderAuthSession(session);
  try {
    await fetchCurrentUserMeta();
  } catch (error) {
    state.currentUserMeta = null;
    renderAdminExportAction();
    if (error?.status !== 404) {
      toast(
        formatRequestError(error, "Không kiểm tra được quyền admin."),
        "warning",
      );
    }
  }

  renderAll();
  if (isCurrentUserAdmin()) {
    await loadAdminMembers();
  }

  logApp("Opening profile for signed-in account", {
    suggestedUsername: state.suggestedUsername,
  });
  const opened = await openMyProfile({ silent: true });
  if (!opened) {
    renderProfileMeta();
    logApp("No profile found for signed-in account", {
      suggestedUsername: state.suggestedUsername,
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
  if (employeeFields.fullName.value.trim()) {
    employeeFields.fullName.setCustomValidity("");
  }

  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  syncStateFromEmployeeForm();
  renderProfileMeta();
  renderJsonPreview();
});

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await updateEmployeeForActiveProfile();
});

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSavingEntry()) {
    return;
  }

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
    note: entryFields.note.value.trim(),
  };

  if (!entry.date || !entry.startTime || !entry.endTime) {
    return;
  }

  try {
    const profile = requireActiveProfile("luu dong OT");
    setSavingEntry(
      true,
      entry.id ? "Đang cập nhật dòng OT..." : "Đang thêm dòng OT mới...",
    );
    const entriesToSave = splitEntryAcrossMidnight(entry, {
      preserveIdOnFirstSegment: Boolean(entry.id),
    });
    if (entry.id) {
      await updateEntryInApi(profile.username, entry.id, entriesToSave[0]);
      for (const extraEntry of entriesToSave.slice(1)) {
        await createEntryInApi(profile.username, extraEntry);
      }
      toast("Đã cập nhật dòng OT thành công.", "success");
    } else {
      for (const newEntry of entriesToSave) {
        await createEntryInApi(profile.username, newEntry);
      }
      toast("Đã thêm dòng OT mới thành công.", "success");
    }

    await openMyProfile({ silent: true });
    fillEntryForm();
  } catch (error) {
    toast(formatRequestError(error, "Không lưu được dòng OT."), "error");
  } finally {
    setSavingEntry(false);
  }
});

entryTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  if (button.classList.contains("edit")) {
    if (isDeletingEntry(button.dataset.id) || isSavingEntry()) {
      return;
    }

    const profile = getActiveProfile();
    const entry = profile?.entries.find(
      (item) => item.id === button.dataset.id,
    );
    if (!entry) {
      return;
    }
    fillEntryForm(entry);
    entryForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (button.classList.contains("delete")) {
    if (isDeletingEntry(button.dataset.id)) {
      return;
    }

    try {
      const profile = requireActiveProfile("xoa dong OT");
      const entry = profile.entries.find(
        (item) => item.id === button.dataset.id,
      );
      if (!entry) {
        toast(
          "Không tìm thấy dòng OT cần xóa trong dữ liệu hiện tại.",
          "error",
        );
        return;
      }

      if (
        !toastConfirm(
          `Xóa dòng OT ngày ${entry.date} (${entry.startTime} – ${entry.endTime})?`,
        )
      ) {
        return;
      }

      setDeletingEntry(entry.id, true);
      await deleteEntryInApi(profile.username, entry.id);
      await openMyProfile({ silent: true });
      fillEntryForm();
      toast("Đã xóa dòng OT thành công.", "success");
    } catch (error) {
      toast(formatRequestError(error, "Không xóa được dòng OT."), "error");
    } finally {
      setDeletingEntry(button.dataset.id, false);
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
  const fullName = getRequiredFullNameForProfileCreation();
  if (!fullName) {
    return;
  }

  await createProfile(usernameInput.value, fullName);
});

deleteProfileButton.addEventListener("click", async () => {
  const profile = getActiveProfile();
  if (!profile || isDeletingProfile(profile.username)) {
    return;
  }

  const confirmed = toastConfirm(
    `Xóa hồ sơ "${profile.username}" trên backend?`,
  );
  if (!confirmed) {
    return;
  }

  try {
    setDeletingProfile(profile.username, true);
    await deleteProfile(profile.username);
    toast(`Đã xóa hồ sơ "${profile.username}" thành công.`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setDeletingProfile(profile.username, false);
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

  try {
    await downloadExcel();
  } catch (error) {
    toast(formatRequestError(error, "Không xuất được file Excel."), "error");
  }
});

adminViewMode?.addEventListener("change", () => {
  state.admin.viewMode = adminViewMode.value === "all" ? "all" : "member";
  state.admin.profiles = [];
  renderAdminPanel();
});

adminMemberSelect?.addEventListener("change", () => {
  state.admin.selectedUsername = adminMemberSelect.value;
  state.admin.profiles = [];
  renderAdminPanel();
});

adminMonthInput?.addEventListener("change", () => {
  state.admin.month = adminMonthInput.value;
  state.admin.profiles = [];
  renderAdminPanel();
});

adminLoadButton?.addEventListener("click", async () => {
  await loadAdminOtData();
});

adminExportButton?.addEventListener("click", async () => {
  if (
    !isCurrentUserAdmin() ||
    state.admin.viewMode !== "all" ||
    isAdminExporting()
  ) {
    return;
  }

  try {
    setAdminExporting(true);
    await downloadAdminOtExport();
    toast("Đã xuất file Excel toàn bộ OT.", "success");
  } catch (error) {
    toast(
      formatRequestError(error, "Không xuất được Excel toàn bộ OT."),
      error?.status === 403 ? "warning" : "error",
    );
  } finally {
    setAdminExporting(false);
  }
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

(function initTheme() {
  const saved = localStorage.getItem("ot-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = saved ? saved === "dark" : true; // default dark
  if (isDark) document.documentElement.setAttribute("data-theme", "dark");
  themeToggleThumb.textContent = isDark ? "🌙" : "☀️";
})();

themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    themeToggleThumb.textContent = "☀️";
    localStorage.setItem("ot-theme", "light");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggleThumb.textContent = "🌙";
    localStorage.setItem("ot-theme", "dark");
  }
});
