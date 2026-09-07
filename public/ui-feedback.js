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

const TOAST_STYLE = {
  borderRadius: "999px",
  padding: "12px 22px",
  fontSize: "0.9rem",
  fontWeight: "600",
  letterSpacing: "0.01em",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  minWidth: "220px",
  maxWidth: "480px",
  textAlign: "center",
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
    style: { ...TOAST_STYLE, background: bg },
  }).showToast();
}

/**
 * Toast with an inline "Hoàn tác" button. The action only fires while the
 * toast is on screen; dismissing it (or letting it expire) accepts the change.
 */
export function toastWithUndo(message, onUndo, { type = "success", duration = 6000 } = {}) {
  const icon = ICONS[type] ?? ICONS.info;
  const bg = BACKGROUNDS[type] ?? BACKGROUNDS.info;

  const node = document.createElement("span");
  node.className = "toast-undo";

  const label = document.createElement("span");
  label.textContent = `${icon}  ${message}`;
  node.append(label);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "toast-undo-button";
  button.textContent = "Hoàn tác";
  node.append(button);

  const instance = Toastify({
    node,
    duration,
    gravity: "top",
    position: "center",
    stopOnFocus: true,
    close: true,
    style: {
      ...TOAST_STYLE,
      background: bg,
      textAlign: "left",
      minWidth: "unset",
      width: "fit-content",
      paddingRight: "16px",
    },
  });

  button.addEventListener("click", () => {
    button.disabled = true;
    instance.hideToast();
    void onUndo();
  });

  instance.showToast();
}

let confirmDialog = null;

function buildConfirmDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="confirm-dialog-form">
      <h2 class="confirm-dialog-title" data-role="title"></h2>
      <p class="confirm-dialog-message" data-role="message"></p>
      <div class="confirm-dialog-actions">
        <button type="submit" value="cancel" class="ghost" data-role="cancel"></button>
        <button type="submit" value="confirm" class="danger" data-role="confirm"></button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  return dialog;
}

/**
 * In-app replacement for window.confirm — themed, focus-trapped by <dialog>,
 * and free of Chrome's "prevent additional dialogs" suppression checkbox.
 */
export function confirmAction(
  message,
  {
    title = "Xác nhận",
    confirmLabel = "Xóa",
    cancelLabel = "Hủy",
    danger = true,
  } = {},
) {
  if (typeof HTMLDialogElement === "undefined") {
    return Promise.resolve(window.confirm(message));
  }

  confirmDialog ??= buildConfirmDialog();
  const dialog = confirmDialog;
  const confirmButton = dialog.querySelector('[data-role="confirm"]');
  const cancelButton = dialog.querySelector('[data-role="cancel"]');

  dialog.querySelector('[data-role="title"]').textContent = title;
  dialog.querySelector('[data-role="message"]').textContent = message;
  confirmButton.textContent = confirmLabel;
  cancelButton.textContent = cancelLabel;
  confirmButton.classList.toggle("danger", danger);

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    );
    dialog.showModal();
    cancelButton.focus();
  });
}
