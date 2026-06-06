export const DEFAULT_SHEET_NAME = "Sheet1";

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

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function normalizeSheetName(value) {
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

export function slugifyUsername(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function encodePath(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function createBlankProfile(username = "my-profile") {
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

export function sanitizeTimer(rawTimer) {
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

export function sanitizeEntry(rawEntry) {
  return {
    id: String(rawEntry?.id ?? "").trim(),
    date: String(rawEntry?.date ?? "").trim(),
    startTime: String(rawEntry?.startTime ?? "").trim(),
    endTime: String(rawEntry?.endTime ?? "").trim(),
    note: String(rawEntry?.note ?? "").trim(),
  };
}

export function sanitizeProfile(rawProfile, fallbackUsername = "my-profile") {
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

export function minutesBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour === 24 ? 1440 : endHour * 60 + endMinute;
  return end >= start ? end - start : 1440 - start + end;
}

export function timeToMinutes(timeText) {
  const [hourText, minuteText] = timeText.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour === 24 ? 1440 : hour * 60 + minute;
}

export function isOvernightRange(startTime, endTime) {
  const normalizedStart = normalizeTime24h(startTime);
  const normalizedEnd = normalizeTime24h(endTime);
  if (!normalizedStart || !normalizedEnd) {
    return false;
  }

  return timeToMinutes(normalizedEnd) < timeToMinutes(normalizedStart);
}

export function shiftDateByDays(dateText, days) {
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

export function getWeekdayLabel(dateText) {
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

export function splitEntryAcrossMidnight(entry, options = {}) {
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

export function splitEntriesAcrossMidnight(entries, options = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  return sourceEntries.reduce((result, entry) => {
    result.push(...splitEntryAcrossMidnight(entry, options));
    return result;
  }, []);
}

export function isEntryInMonth(entry, month) {
  const normalizedMonth = String(month ?? "").trim();
  if (!normalizedMonth) {
    return true;
  }

  return String(entry?.date ?? "").startsWith(normalizedMonth);
}

export function getEntriesForMonth(entries, month, options = {}) {
  return splitEntriesAcrossMidnight(entries, options).filter((entry) =>
    isEntryInMonth(entry, month),
  );
}

export function normalizeTime24h(value) {
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

export function formatDurationMinutes(totalMinutes) {
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

export function formatDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTimeInputValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTimeDisplay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
