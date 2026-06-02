import {
  encodePath,
  sanitizeEntry,
  sanitizeProfile,
  sanitizeTimer,
  slugifyUsername,
} from "./domain.js";

const API_LOG_PREFIX = "[OT API]";

export function createOtApiClient({
  apiBaseUrl,
  getAccessToken,
  refreshSession,
  onUnauthorized,
  logApi = () => {},
}) {
  async function request(path, options = {}) {
    const { method = "GET", body, retryOnUnauthorized = true } = options;
    const token = await getAccessToken();
    logApi("Preparing request", {
      method,
      url: `${apiBaseUrl}${path}`,
      hasToken: Boolean(token),
      retryOnUnauthorized,
    });

    if (!token) {
      console.error(`${API_LOG_PREFIX} Missing access token`, { path, method });
      throw new Error(
        "Không tìm thấy Supabase access token. Hãy đăng nhập lại.",
      );
    }

    let response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
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
        url: `${apiBaseUrl}${path}`,
        error,
      });
      throw error;
    }

    logApi("Received response", {
      method,
      url: `${apiBaseUrl}${path}`,
      status: response.status,
      ok: response.ok,
    });

    if (response.status === 401 && retryOnUnauthorized) {
      try {
        logApi("Received 401, attempting refresh");
        const refreshedSession = await refreshSession();
        if (refreshedSession?.access_token) {
          logApi("Refresh succeeded, retrying request", { method, path });
          return request(path, {
            method,
            body,
            retryOnUnauthorized: false,
          });
        }
      } catch {
        console.error(
          `${API_LOG_PREFIX} Refresh failed after 401, redirecting to login`,
        );
        onUnauthorized?.();
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
        url: `${apiBaseUrl}${path}`,
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

  async function requestWithFallback(primaryPath, fallbackPath, options = {}) {
    try {
      return await request(primaryPath, options);
    } catch (error) {
      if (!fallbackPath || ![404, 405, 501].includes(error?.status)) {
        throw error;
      }

      logApi("Primary route unavailable, falling back", {
        primaryPath,
        fallbackPath,
        status: error.status,
      });
      return request(fallbackPath, options);
    }
  }

  return {
    fetchCurrentUserMeta() {
      return request("/api/me");
    },

    async fetchAdminMembers() {
      const payload = await request("/api/admin/members");
      const members = Array.isArray(payload?.members)
        ? payload.members
        : Array.isArray(payload?.data?.members)
          ? payload.data.members
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload)
              ? payload
              : [];

      return members
        .map((member) => ({
          ...member,
          username: slugifyUsername(
            member?.username ??
              member?.profile?.username ??
              member?.account?.username ??
              member?.user?.username,
          ),
        }))
        .filter((member) => member.username);
    },

    async fetchAdminOtData(month = "") {
      const query = month ? `?month=${encodeURIComponent(month)}` : "";
      const payload = await request(`/api/admin/ot-data${query}`);
      return {
        month: payload?.month || null,
        profiles: getProfilesFromAdminPayload(payload),
      };
    },

    async fetchMyProfile(username, fallbackUsername = "my-profile") {
      const normalizedUsername = slugifyUsername(username);
      const fallbackPath = normalizedUsername
        ? `/api/profiles/${encodePath(normalizedUsername)}`
        : null;
      const profile = sanitizeProfile(
        await requestWithFallback(
          "/api/profiles/me",
          fallbackPath,
        ),
        normalizedUsername || fallbackUsername,
      );

      if (
        !fallbackPath ||
        (!normalizedUsername && profile.entries.length > 0) ||
        (profile.username === normalizedUsername && profile.entries.length > 0)
      ) {
        return profile;
      }

      try {
        const fallbackProfile = sanitizeProfile(
          await request(fallbackPath),
          normalizedUsername || fallbackUsername,
        );

        if (
          profile.username !== normalizedUsername ||
          fallbackProfile.entries.length > profile.entries.length
        ) {
          return fallbackProfile;
        }
      } catch (error) {
        if (profile.username !== normalizedUsername) {
          throw error;
        }
      }

      return profile;
    },

    async fetchProfileByUsername(username) {
      const normalizedUsername = slugifyUsername(username);
      if (!normalizedUsername) {
        throw new Error("Thiếu username để tải hồ sơ.");
      }

      return sanitizeProfile(
        await request(`/api/profiles/${encodePath(normalizedUsername)}`),
        normalizedUsername,
      );
    },

    async fetchAdminProfileByUsername(username) {
      const normalizedUsername = slugifyUsername(username);
      if (!normalizedUsername) {
        throw new Error("Thiếu username để tải hồ sơ.");
      }

      const profile = sanitizeProfile(
        await requestWithFallback(
          `/api/admin/profiles/${encodePath(normalizedUsername)}`,
          `/api/profiles/${encodePath(normalizedUsername)}`,
        ),
        normalizedUsername,
      );

      if (profile.username !== normalizedUsername) {
        throw new Error(
          `API trả về hồ sơ "${profile.username}" thay vì "${normalizedUsername}".`,
        );
      }

      return profile;
    },

    async createProfile(username) {
      return sanitizeProfile(
        await requestWithFallback("/api/profiles/me/init", "/api/profiles", {
          method: "POST",
          body: { username },
        }),
        username,
      );
    },

    async updateProfile(profile) {
      return sanitizeProfile(
        await requestWithFallback(
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
    },

    deleteProfile(username) {
      return request(`/api/profiles/${encodePath(username)}`, {
        method: "DELETE",
      });
    },

    async createEntry(username, entry) {
      return sanitizeEntry(
        await requestWithFallback(
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
    },

    async updateEntry(username, entryId, entry) {
      return sanitizeEntry(
        await requestWithFallback(
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
    },

    deleteEntry(username, entryId) {
      return requestWithFallback(
        `/api/profiles/me/entries/${encodePath(entryId)}`,
        `/api/profiles/${encodePath(username)}/entries/${encodePath(entryId)}`,
        { method: "DELETE" },
      );
    },

    async startTimer(username, note) {
      return sanitizeTimer(
        await requestWithFallback(
          "/api/profiles/me/timer/start",
          `/api/profiles/${encodePath(username)}/timer/start`,
          {
            method: "POST",
            body: { note },
          },
        ),
      );
    },

    async updateTimer(username, note) {
      return sanitizeTimer(
        await requestWithFallback(
          "/api/profiles/me/timer",
          `/api/profiles/${encodePath(username)}/timer`,
          {
            method: "PUT",
            body: { note },
          },
        ),
      );
    },

    async stopTimer(username, note) {
      return sanitizeEntry(
        await requestWithFallback(
          "/api/profiles/me/timer/stop",
          `/api/profiles/${encodePath(username)}/timer/stop`,
          {
            method: "POST",
            body: { note },
          },
        ),
      );
    },
  };
}

export function getProfilesFromAdminPayload(payload) {
  const profiles = Array.isArray(payload?.profiles)
    ? payload.profiles
    : Array.isArray(payload?.data?.profiles)
      ? payload.data.profiles
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

  return profiles
    .map((profile) => sanitizeProfile(profile, profile?.username))
    .filter((profile) => profile.username);
}

export function mergeProfilesByUsername(...profileLists) {
  const merged = new Map();
  profileLists.flat().forEach((profile) => {
    const normalizedProfile = sanitizeProfile(profile, profile?.username);
    if (normalizedProfile.username) {
      merged.set(normalizedProfile.username, normalizedProfile);
    }
  });

  return [...merged.values()];
}
