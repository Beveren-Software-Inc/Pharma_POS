/** Remove stale full-screen overlays that can block sidebar clicks after print/modals. */
export function cleanupStaleOverlays() {
  document.querySelectorAll(".print-overlay").forEach((el) => el.remove());
  document.body.style.removeProperty("overflow");
}
