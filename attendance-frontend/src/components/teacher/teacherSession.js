import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SERVER_URL from "../../config/api";
import { useToast } from "../../ui/Toast";

export const teacherLinks = (active) => [
  { to: "/teacher-dashboard", label: "Dashboard", active: active === "dashboard" },
  { to: "/teacher/classes", label: "Classes & rosters", active: active === "classes" },
  { to: "/teacher/reviews", label: "Reviews", active: active === "reviews" },
  { to: "/acoustic-lab", label: "Phone audio test" },
];

// Loads the signed-in teacher; students go to their dashboard, anyone else to login.
export const useTeacherSession = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [user, setUser] = useState(null);

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

  return { user, logout };
};
