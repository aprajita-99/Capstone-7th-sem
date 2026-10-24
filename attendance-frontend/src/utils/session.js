import axios from "axios";
import SERVER_URL from "../config/api";

// The signed-in user (GET /islogin), shared between pages for a short time so
// moving between pages does not wait for the same round trip every time.
// Cleared on logout and on a new sign-in; failures are never cached.
const TTL_MS = 60 * 1000;
let cached = null; // { promise, at }

export const clearSession = () => {
  cached = null;
};

// Same shape as axios.get(`${SERVER_URL}/islogin`): resolves to the response.
export const fetchSessionUser = () => {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = axios.get(`${SERVER_URL}/islogin`, { withCredentials: true });
  cached = { promise, at: Date.now() };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
};

// Logging out anywhere (every page calls GET /logout) drops the cached user.
axios.interceptors.request.use((config) => {
  if (String(config.url || "").endsWith("/logout")) clearSession();
  return config;
});
