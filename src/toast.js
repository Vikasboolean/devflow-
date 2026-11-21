export function showToast(message, type = "info") {
  if (!message) return;
  window.dispatchEvent(new CustomEvent("devflow:toast", { detail: { message: String(message), type } }));
}
