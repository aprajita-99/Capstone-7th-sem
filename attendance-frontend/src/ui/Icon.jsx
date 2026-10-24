import React from "react";
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiArrowLeft,
  FiAward,
  FiBarChart2,
  FiBookOpen,
  FiCamera,
  FiCheck,
  FiCheckCircle,
  FiClipboard,
  FiClock,
  FiCreditCard,
  FiCrosshair,
  FiDownload,
  FiEye,
  FiHeadphones,
  FiHome,
  FiInbox,
  FiLock,
  FiMessageSquare,
  FiMic,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiSmartphone,
  FiSmile,
  FiSquare,
  FiUser,
  FiUsers,
  FiVolume2,
  FiX,
} from "react-icons/fi";

// One stroke icon set (Feather) for the whole app; replaces emoji.
const ICONS = {
  alert: FiAlertCircle,
  warning: FiAlertTriangle,
  back: FiArrowLeft,
  award: FiAward,
  chart: FiBarChart2,
  classes: FiBookOpen,
  camera: FiCamera,
  check: FiCheck,
  done: FiCheckCircle,
  clipboard: FiClipboard,
  clock: FiClock,
  idcard: FiCreditCard,
  target: FiCrosshair,
  download: FiDownload,
  eye: FiEye,
  headphones: FiHeadphones,
  home: FiHome,
  inbox: FiInbox,
  lock: FiLock,
  message: FiMessageSquare,
  mic: FiMic,
  retry: FiRefreshCw,
  search: FiSearch,
  shield: FiShield,
  phone: FiSmartphone,
  face: FiSmile,
  stop: FiSquare,
  user: FiUser,
  users: FiUsers,
  sound: FiVolume2,
  close: FiX,
};

/** <Icon name="sound" /> — decorative by default; pass `label` when the icon carries meaning on its own. */
const Icon = ({ name, size, label, className = "" }) => {
  const Component = ICONS[name] || FiAlertCircle;
  return (
    <Component
      className={`ui-icon ${className}`}
      size={size}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
    />
  );
};

export default Icon;
