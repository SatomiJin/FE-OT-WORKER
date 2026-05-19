import {
  getAccessToken,
  getAuthConfig,
  getUserSnapshot,
  replayPersistedDebugLogs,
  refreshSession,
  requireSession,
  signOut,
} from "./auth.js";

function toast(message, type = "info") {
  const backgrounds = {
    success: "linear-gradient(135deg, #2e7d32, #43a047)",
    error: "linear-gradient(135deg, #c62828, #e53935)",
    info: "linear-gradient(135deg, #1565c0, #1e88e5)",
    warning: "linear-gradient(135deg, #e65100, #fb8c00)",
  };
  Toastify({
    text: message,
    duration: type === "error" ? 5000 : 3000,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: { background: backgrounds[type] ?? backgrounds.info },
  }).showToast();
}

function toastConfirm(message) {
  return window.confirm(message);
}

const API_BASE_URL = getAuthConfig().apiBaseUrl;
const APP_LOG_PREFIX = "[OT App]";
const API_LOG_PREFIX = "[OT API]";
const WEEKDAY_LABELS = [
  "Chủ nhật",
  "Thứ hai",
  "Thứ ba",
  "Thứ tư",
  "Thứ năm",
  "Thứ sáu",
  "Thứ bảy",
];
const weekdayLabelCache = new Map();
const DEFAULT_SHEET_NAME = "Sheet1";

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
  const message = error.message
    ? String(error.message).trim()
    : fallbackMessage;
  return `${message}${statusText}`;
}

replayPersistedDebugLogs("app page");

const state = {
  suggestedUsername: "",
  activeUsername: "",
  profiles: {},
  profileSaveHandle: 0,
  timerNoteSaveHandle: 0,
  loading: {
    savingEntry: false,
    deletingEntryIds: new Set(),
    deletingProfileUsername: "",
    creatingProfile: false,
    stoppingTimer: false,
  },
};

const profileForm = document.querySelector("#profileForm");
const usernameInput = document.querySelector("#usernameInput");
const employeeForm = document.querySelector("#employeeForm");
const entryForm = document.querySelector("#entryForm");
const entryFormOverlay = document.querySelector("#entryFormOverlay");
const entryFormOverlayText = document.querySelector("#entryFormOverlayText");
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeSheetName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return DEFAULT_SHEET_NAME;
  }

  const comparable = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (comparable === "sheet1" || comparable === "trangtinh1") {
    return DEFAULT_SHEET_NAME;
  }

  return normalized;
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
      sheetName: DEFAULT_SHEET_NAME,
    },
    entries: [],
    activeTimer: null,
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
    note: String(rawTimer.note ?? "").trim(),
  };
}

function sanitizeEntry(rawEntry) {
  return {
    id: String(rawEntry?.id ?? "").trim(),
    date: String(rawEntry?.date ?? "").trim(),
    startTime: String(rawEntry?.startTime ?? "").trim(),
    endTime: String(rawEntry?.endTime ?? "").trim(),
    note: String(rawEntry?.note ?? "").trim(),
  };
}

function sanitizeProfile(rawProfile, fallbackUsername = "my-profile") {
  const username =
    slugifyUsername(rawProfile?.username ?? fallbackUsername) || "my-profile";
  const employee = rawProfile?.employee ?? {};
  const entries = Array.isArray(rawProfile?.entries) ? rawProfile.entries : [];

  return {
    username,
    selectedMonth: String(rawProfile?.selectedMonth ?? "").trim(),
    employee: {
      label:
        String(
          employee.label ?? (username.slice(0, 4).toUpperCase() || "DEMO"),
        ).trim() || "DEMO",
      employeeCode: String(employee.employeeCode ?? "").trim(),
      fullName: String(employee.fullName ?? "").trim(),
      sheetName: normalizeSheetName(employee.sheetName),
    },
    activeTimer: sanitizeTimer(rawProfile?.activeTimer),
    entries: entries
      .map((entry) => sanitizeEntry(entry))
      .filter(
        (entry) => entry.id && entry.date && entry.startTime && entry.endTime,
      ),
  };
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

function isOvernightRange(startTime, endTime) {
  const normalizedStart = normalizeTime24h(startTime);
  const normalizedEnd = normalizeTime24h(endTime);
  if (!normalizedStart || !normalizedEnd) {
    return false;
  }

  return timeToMinutes(normalizedEnd) < timeToMinutes(normalizedStart);
}

function shiftDateByDays(dateText, days) {
  const match = String(dateText ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function getWeekdayLabel(dateText) {
  const normalizedDate = String(dateText ?? "").trim();
  if (!normalizedDate) {
    return "";
  }

  if (weekdayLabelCache.has(normalizedDate)) {
    return weekdayLabelCache.get(normalizedDate) ?? "";
  }

  const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    weekdayLabelCache.set(normalizedDate, "");
    return "";
  }

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  const weekdayLabel = Number.isNaN(date.getTime())
    ? ""
    : (WEEKDAY_LABELS[date.getUTCDay()] ?? "");
  weekdayLabelCache.set(normalizedDate, weekdayLabel);
  return weekdayLabel;
}

function splitEntryAcrossMidnight(entry, options = {}) {
  const { preserveIdOnFirstSegment = false } = options;
  const normalizedEntry = sanitizeEntry(entry);
  const normalizedStart = normalizeTime24h(normalizedEntry.startTime);
  const normalizedEnd = normalizeTime24h(normalizedEntry.endTime);

  if (
    !normalizedEntry.date ||
    !normalizedStart ||
    !normalizedEnd ||
    !isOvernightRange(normalizedStart, normalizedEnd)
  ) {
    return [normalizedEntry];
  }

  const nextDate = shiftDateByDays(normalizedEntry.date, 1);
  if (!nextDate) {
    return [normalizedEntry];
  }

  const firstSegment = {
    ...normalizedEntry,
    id: preserveIdOnFirstSegment ? normalizedEntry.id : "",
    startTime: normalizedStart,
    endTime: "24:00",
  };

  if (normalizedEnd === "00:00") {
    return [firstSegment];
  }

  return [
    firstSegment,
    {
      ...normalizedEntry,
      id: "",
      date: nextDate,
      startTime: "00:00",
      endTime: normalizedEnd,
    },
  ];
}

function splitEntriesAcrossMidnight(entries, options = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  return sourceEntries.reduce((result, entry) => {
    result.push(...splitEntryAcrossMidnight(entry, options));
    return result;
  }, []);
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

async function apiRequest(path, options = {}) {
  const { method = "GET", body, retryOnUnauthorized = true } = options;
  const token = await getAccessToken();
  logApi("Preparing request", {
    method,
    url: `${API_BASE_URL}${path}`,
    hasToken: Boolean(token),
    retryOnUnauthorized,
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
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error(`${API_LOG_PREFIX} Network request failed`, {
      method,
      url: `${API_BASE_URL}${path}`,
      error,
    });
    throw error;
  }

  logApi("Received response", {
    method,
    url: `${API_BASE_URL}${path}`,
    status: response.status,
    ok: response.ok,
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
          retryOnUnauthorized: false,
        });
      }
    } catch {
      console.error(
        `${API_LOG_PREFIX} Refresh failed after 401, redirecting to login`,
      );
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
      payload,
    });
    const error = new Error(
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : `Request failed with status ${response.status}.`,
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
      status: error.status,
    });
    return apiRequest(fallbackPath, options);
  }
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

async function fetchMyProfileFromApi() {
  const username =
    slugifyUsername(getActiveProfile()?.username) ||
    slugifyUsername(usernameInput.value) ||
    state.suggestedUsername;

  return sanitizeProfile(
    await apiRequestWithFallback(
      "/api/profiles/me",
      username ? `/api/profiles/${encodePath(username)}` : null,
    ),
    username || state.suggestedUsername,
  );
}

async function createProfileInApi(username) {
  return sanitizeProfile(
    await apiRequestWithFallback("/api/profiles/me/init", "/api/profiles", {
      method: "POST",
      body: { username },
    }),
    username,
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
            sheetName: profile.employee.sheetName,
          },
        },
      },
    ),
    profile.username,
  );
}

async function deleteProfileInApi(username) {
  await apiRequest(`/api/profiles/${encodePath(username)}`, {
    method: "DELETE",
  });
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
          note: entry.note,
        },
      },
    ),
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
          note: entry.note,
        },
      },
    ),
  );
}

async function deleteEntryInApi(username, entryId) {
  await apiRequestWithFallback(
    `/api/profiles/me/entries/${encodePath(entryId)}`,
    `/api/profiles/${encodePath(username)}/entries/${encodePath(entryId)}`,
    { method: "DELETE" },
  );
}

async function startTimerInApi(username, note) {
  return sanitizeTimer(
    await apiRequestWithFallback(
      "/api/profiles/me/timer/start",
      `/api/profiles/${encodePath(username)}/timer/start`,
      {
        method: "POST",
        body: { note },
      },
    ),
  );
}

async function updateTimerInApi(username, note) {
  return sanitizeTimer(
    await apiRequestWithFallback(
      "/api/profiles/me/timer",
      `/api/profiles/${encodePath(username)}/timer`,
      {
        method: "PUT",
        body: { note },
      },
    ),
  );
}

async function stopTimerInApi(username, note) {
  return sanitizeEntry(
    await apiRequestWithFallback(
      "/api/profiles/me/timer/stop",
      `/api/profiles/${encodePath(username)}/timer/stop`,
      {
        method: "POST",
        body: { note },
      },
    ),
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

function renderAll() {
  renderProfileList();
  renderProfileMeta();
  renderProfileActions();
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

const OT_EXPORT_HEADERS = [
  "DEMO",
  "MSNV",
  "Họ và tên",
  "",
  "Ngày ghi nhận OT",
  "Thời gian vào ca",
  "Thời gian ra ca",
  "Tổng giờ OT",
  "Giải trình (7,14,21,28)",
];
const OT_EXPORT_COLUMN_WIDTHS = [
  16.75, 16.75, 22.13, 22.13, 36.63, 16.75, 16.75, 16.75, 94.75,
];
const OT_EXPORT_COLORS = {
  headerText: "FF914D4F",
  dateFill: "FFB7E1CD",
  hoursText: "FF4A86E8",
  border: "FF000000",
};

function createOtExportBorder() {
  return {
    top: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    right: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    bottom: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    left: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
  };
}

function createOtExportHeaderStyle(overrides = {}) {
  return {
    font: {
      bold: true,
      color: { argb: OT_EXPORT_COLORS.headerText },
    },
    alignment: {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    },
    border: createOtExportBorder(),
    ...overrides,
  };
}

function createOtExportCellStyle(overrides = {}) {
  return {
    alignment: {
      vertical: "middle",
    },
    border: createOtExportBorder(),
    ...overrides,
  };
}

function parseExcelCompatibleDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = String(value ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseExcelCompatibleTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  const isMidnightBoundary = hour === 24 && minute === 0 && second === 0;
  const isRegularTime =
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59;

  if (!isMidnightBoundary && !isRegularTime) {
    return null;
  }

  const totalSeconds = isMidnightBoundary
    ? 86400
    : hour * 3600 + minute * 60 + second;
  return totalSeconds / 86400;
}

function normalizeOtExportRecord(record) {
  const date = parseExcelCompatibleDate(record?.date);
  const startTimeSerial = parseExcelCompatibleTime(record?.startTime);
  const endTimeSerial = parseExcelCompatibleTime(record?.endTime);
  const startTimeText = String(record?.startTime ?? "").trim();
  const endTimeText = String(record?.endTime ?? "").trim();

  if (!date || startTimeSerial === null || endTimeSerial === null) {
    return null;
  }

  return {
    date,
    startTimeSerial,
    endTimeSerial,
    startTimeText,
    endTimeText,
    totalHours:
      minutesBetween(
        normalizeTime24h(startTimeText) ?? startTimeText,
        normalizeTime24h(endTimeText) ?? endTimeText,
      ) / 60,
    note: String(record?.note ?? "").trim(),
  };
}

function formatOtHoursForExport(value) {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) {
    return "0.00";
  }

  return normalizedValue.toFixed(2);
}

function createOtExportWorkbook(records, employee = {}) {
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "OT Tracker";
  workbook.calcProperties.fullCalcOnLoad = true;
  const worksheet = workbook.addWorksheet(
    normalizeSheetName(employee.sheetName),
    {
      views: [{ state: "frozen", ySplit: 1 }],
    },
  );

  setOtExportColumnWidths(worksheet);
  writeOtExportHeader(worksheet);
  writeOtExportRows(worksheet, records, employee);

  return workbook;
}

function setOtExportColumnWidths(worksheet) {
  worksheet.columns = OT_EXPORT_COLUMN_WIDTHS.map((width) => ({ width }));
}

function writeOtExportHeader(worksheet) {
  const headerRow = worksheet.getRow(1);
  OT_EXPORT_HEADERS.forEach((value, index) => {
    headerRow.getCell(index + 1).value = value;
  });

  headerRow.height = 28;
  applyOtExportHeaderStyles(headerRow);
}

function applyOtExportHeaderStyles(row) {
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const headerStyle = createOtExportHeaderStyle();

    if (columnNumber === 5) {
      headerStyle.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: OT_EXPORT_COLORS.dateFill },
      };
    }

    if (columnNumber === 8) {
      headerStyle.font = {
        bold: true,
        color: { argb: OT_EXPORT_COLORS.hoursText },
      };
    }

    cell.style = headerStyle;
  });
}

function writeOtExportRows(worksheet, records, employee) {
  const normalizedRecords = records
    .map((record) => normalizeOtExportRecord(record))
    .filter(Boolean);
  const employeeCode = String(employee.employeeCode ?? "").trim();
  const employeeName = String(employee.fullName ?? "").trim();

  normalizedRecords.forEach((record, index) => {
    const rowNumber = index + 2;
    const row = worksheet.getRow(rowNumber);

    row.getCell(1).value = "DEMO";
    row.getCell(2).value = employeeCode;
    row.getCell(3).value = employeeName;
    row.getCell(4).value = "";
    row.getCell(5).value = record.date;
    row.getCell(6).value = record.startTimeSerial;
    row.getCell(7).value = record.endTimeSerial;
    row.getCell(8).value = {
      formula: `SUBSTITUTE(TEXT(MOD(G${rowNumber}-F${rowNumber},1)*24,"0.00"),",",".")`,
      result: formatOtHoursForExport(record.totalHours),
    };
    row.getCell(9).value = record.note;

    applyOtExportDataStyles(row);
  });
}

function applyOtExportDataStyles(row) {
  row.height = 22;

  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const isCentered = columnNumber >= 5 && columnNumber <= 8;
    cell.style = createOtExportCellStyle({
      alignment: {
        horizontal: isCentered ? "center" : "left",
        vertical: "middle",
      },
    });

    if (columnNumber === 5) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: OT_EXPORT_COLORS.dateFill },
      };
      cell.numFmt = "dd/MM/yyyy";
    }

    if (columnNumber === 6 || columnNumber === 7) {
      cell.numFmt = "HH:mm:ss";
    }

    if (columnNumber === 8) {
      cell.font = {
        color: { argb: OT_EXPORT_COLORS.hoursText },
      };
      cell.numFmt = "@";
    }
  });
}

async function downloadExcel() {
  const profile = exportableProfile();
  const month = getSelectedMonth() || guessMonthForProfile(profile);
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

  const workbook = createOtExportWorkbook(exportRecords, profile.employee);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${profile.username}-${month}.xlsx`);
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

async function createProfile(username) {
  const normalized = slugifyUsername(username) || state.suggestedUsername;
  if (!normalized) {
    toast("Nhập username trước khi tạo hồ sơ.", "warning");
    return false;
  }

  try {
    setCreatingProfile(true);
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
  } finally {
    setCreatingProfile(false);
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

  renderAll();

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
  await createProfile(usernameInput.value);
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
