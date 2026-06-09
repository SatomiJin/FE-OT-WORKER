const ICONS = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

const BACKGROUNDS = {
  success: "linear-gradient(135deg, #1b5e20, #2e7d32)",
  error: "linear-gradient(135deg, #b71c1c, #c62828)",
  info: "linear-gradient(135deg, #0d47a1, #1565c0)",
  warning: "linear-gradient(135deg, #bf360c, #e64a19)",
};

export function toast(message, type = "info") {
  const icon = ICONS[type] ?? ICONS.info;
  const bg = BACKGROUNDS[type] ?? BACKGROUNDS.info;

  Toastify({
    text: `${icon}  ${message}`,
    duration: type === "error" ? 5500 : 3200,
    gravity: "top",
    position: "center",
    stopOnFocus: true,
    style: {
      background: bg,
      borderRadius: "999px",
      padding: "12px 22px",
      fontSize: "0.9rem",
      fontWeight: "600",
      letterSpacing: "0.01em",
      boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
      minWidth: "220px",
      maxWidth: "480px",
      textAlign: "center",
    },
  }).showToast();
}

export function toastConfirm(message) {
  return window.confirm(message);
}
