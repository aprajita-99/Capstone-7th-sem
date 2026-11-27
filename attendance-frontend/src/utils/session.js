import axios from "axios";
import SERVER_URL from "../config/api";

// Signed-in user and recent page data, kept so pages show something at once
// instead of waiting on the network every time (stale-while-revalidate).
//
// - The user (GET /islogin) is reused for 60 s in memory, and the last known
//   user is kept in sessionStorage so a reload can render straight away while
//   /islogin re-checks in the background.
// - cachedGet / peekCached remember the last response of page GETs, so a page
//   opened again shows its last data while it refreshes.
// Only profile and page data is stored (the login token stays in its httpOnly
// cookie). Everything is cleared on logout, on a new sign-in and on any 401.
const TTL_MS = 60 * 1000;
const USER_KEY = "mmp:user";
const DATA_PREFIX = "mmp:get:";
let cached = null; // { promise, at }
const memory = new Map(); // url -> response data

const store = {
  get(key) {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: memory still works for this page view.
    }
  },
  clear() {
    try {
      Object.keys(window.sessionStorage)
        .filter((key) => key === USER_KEY || key.startsWith(DATA_PREFIX))
        .forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      // Nothing stored.
    }
  },
};

export const clearSession = () => {
  cached = null;
  memory.clear();
  store.clear();
};

// Sign-in already returned the user: reuse it instead of asking /islogin again.
export const primeSession = (user) => {
  clearSession();
  cached = { promise: Promise.resolve({ data: { success: true, user } }), at: Date.now() };
  store.set(USER_KEY, user);
};

// Last known signed-in user (may be stale; always confirm with fetchSessionUser).
export const cachedSessionUser = () => store.get(USER_KEY);

// Same shape as axios.get(`${SERVER_URL}/islogin`): resolves to the response.
export const fetchSessionUser = () => {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = axios.get(`${SERVER_URL}/islogin`, { withCredentials: true });
  cached = { promise, at: Date.now() };
  promise.then(
    (response) => store.set(USER_KEY, response.data.user),
    () => {
      if (cached?.promise === promise) cached = null;
    }
  );
  return promise;
};

// Last saved response data for this GET url, or undefined.
export const peekCached = (url) => {
  if (memory.has(url)) return memory.get(url);
  const saved = store.get(DATA_PREFIX + url);
  if (saved !== null) memory.set(url, saved);
  return saved === null ? undefined : saved;
};

// axios.get with credentials that also remembers the response for peekCached.
export const cachedGet = async (url) => {
  const response = await axios.get(url, { withCredentials: true });
  memory.set(url, response.data);
  store.set(DATA_PREFIX + url, response.data);
  return response;
};

// Logging out anywhere (every page calls GET /logout) drops the cached user and data.
axios.interceptors.request.use((config) => {
  if (String(config.url || "").endsWith("/logout")) clearSession();
  return config;
});
// A 401 means the cookie is gone or expired: never show cached data after that.
axios.interceptors.response.use(undefined, (error) => {
  if (error?.response?.status === 401) clearSession();
  return Promise.reject(error);
});
