import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { cachedGet, cachedSessionUser, fetchSessionUser, peekCached } from "../../utils/session";
import { useToast } from "../../ui/Toast";
import useLiveRefresh from "../../utils/useLiveRefresh";

// counts: GET /reviews/counts → the Reviews link shows the number of open cases.
export const teacherLinks = (active, counts) => [
  { to: "/teacher-dashboard", label: "Dashboard", tabLabel: "Home", icon: "home", tab: true, active: active === "dashboard" },
  { to: "/teacher/classes", label: "Classes & rosters", tabLabel: "Classes", icon: "classes", tab: true, active: active === "classes" },
  { to: "/teacher/reviews", label: "Reviews", icon: "check", tab: true, active: active === "reviews", count: counts?.total || 0 },
  { to: "/acoustic-lab", label: "Phone audio test" },
  { to: "/help", label: "Help" },
];

// Open review counts for the nav badge (best-effort; the page works without them).
const COUNTS_URL = `${SERVER_URL}/reviews/counts`;
export const fetchReviewCounts = () => cachedGet(COUNTS_URL).then((response) => response.data.counts);
// Last known counts (shown at once while they refresh), or null.
export const cachedReviewCounts = () => peekCached(COUNTS_URL)?.counts ?? null;
// Last known signed-in teacher, or null (always confirmed by fetchSessionUser).
export const cachedTeacher = () => {
  const user = cachedSessionUser();
  return user?.role === "teacher" ? user : null;
};

// Loads the signed-in teacher (+ open review counts); students go to their dashboard, anyone else to login.
export const useTeacherSession = () => {
  const navigate = useNavigate();
  const toast = useToast();
  // Start from the last known teacher so the page renders at once.
  const [user, setUser] = useState(cachedTeacher);
  const [counts, setCounts] = useState(cachedReviewCounts);

  useEffect(() => {
    let cancelled = false;
    // Counts load together with the login check, not after it.
    const countsRequest = fetchReviewCounts();
    countsRequest.catch(() => {});
    fetchSessionUser()
      .then((response) => {
        if (cancelled) return;
        if (response.data.user.role !== "teacher") {
          navigate("/student-dashboard");
          return;
        }
        setUser(response.data.user);
        countsRequest
          .then((value) => {
            if (!cancelled) setCounts(value);
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) navigate("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await axios.get(`${SERVER_URL}/logout`, { withCredentials: true });
    } catch (error) {
      // Sign-out is best-effort; the local session ends either way.
    }
    navigate("/");
    toast("Signed out. See you next class!", "success");
  }, [navigate, toast]);

  const refreshCounts = useCallback(() => fetchReviewCounts().then(setCounts).catch(() => {}), []);
  // The nav's review count stays current: every minute and when the teacher returns to the app.
  useLiveRefresh(refreshCounts, 60000, Boolean(user));

  return { user, logout, counts, refreshCounts };
};
