// Student navigation (top bar on wide screens).
export const studentLinks = (active) => [
  { to: "/student-dashboard", label: "Dashboard", active: active === "dashboard" },
  { to: "/student/attendance", label: "Attendance", active: active === "attendance" },
  { to: "/acoustic-lab", label: "Phone audio test" },
];
