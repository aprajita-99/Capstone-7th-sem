// Student navigation: top bar on wide screens, bottom tab bar on phones.
export const studentLinks = (active) => [
  { to: "/student-dashboard", label: "Dashboard", tabLabel: "Home", icon: "home", tab: true, active: active === "dashboard" },
  { to: "/student/attendance", label: "Attendance", icon: "chart", tab: true, active: active === "attendance" },
  { to: "/acoustic-lab", label: "Phone audio test", tabLabel: "Sound test", icon: "sound", tab: true },
  { to: "/help", label: "Help" },
];
