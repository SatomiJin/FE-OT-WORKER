export function toast(message, type = "info") {
  const backgrounds = {
    success: "linear-gradient(135deg, #2e7d32, #43a047)",
    error: "linear-gradient(135deg, #c62828, #e53935)",
    info: "linear-gradient(135deg, #1565c0, #1e88e5)",
    warning: "linear-gradient(135deg, #e65100, #fb8c00)",
  };

  Toastify({
    text: message,
    duration: type === "error" ? 5000 : 3000,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: { background: backgrounds[type] ?? backgrounds.info },
  }).showToast();
}

export function toastConfirm(message) {
  return window.confirm(message);
}
