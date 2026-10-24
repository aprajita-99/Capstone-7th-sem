import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { useToast } from "../../ui/Toast";

// counts: GET /reviews/counts → the Reviews link shows the number of open cases.
export const teacherLinks = (active, counts) => [
  { to: "/teacher-dashboard", label: "Dashboard", tabLabel: "Home", icon: "home", tab: true, active: active === "dashboard" },
  { to: "/teacher/classes", label: "Classes & rosters", tabLabel: "Classes", icon: "classes", tab: true, active: active === "classes" },
  { to: "/teacher/reviews", label: "Reviews", icon: "check", tab: true, active: active === "reviews", count: counts?.total || 0 },
  { to: "/acoustic-lab", label: "Phone audio test" },
];

// Open review counts for the nav badge (best-effort; the page works without them).
export const fetchReviewCounts = () =>
  axios.get(`${SERVER_URL}/reviews/counts`, { withCredentials: true }).then((response) => response.data.counts);

// Loads the signed-in teacher (+ open review counts); students go to their dashboard, anyone else to login.
export const useTeacherSession = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${SERVER_URL}/islogin`, { withCredentials: true })
      .then((response) => {
        if (cancelled) return;
        if (response.data.user.role !== "teacher") {
          navigate("/student-dashboard");
          return;
        }
        setUser(response.data.user);
        fetchReviewCounts()
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

  return { user, logout, counts, refreshCounts };
};
