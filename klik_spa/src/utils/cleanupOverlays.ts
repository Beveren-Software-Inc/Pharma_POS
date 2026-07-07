/** Remove stale full-screen overlays that can block sidebar clicks after print/modals. */
export function cleanupStaleOverlays() {
  document.querySelectorAll(".print-overlay").forEach((el) => el.remove());

  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("pointer-events");

  // Print flow can hide direct body children; restore them if print cleanup was interrupted.
  Array.from(document.body.children).forEach((child) => {
    const el = child as HTMLElement;
    if (el.style.display === "none") {
      el.style.removeProperty("display");
    }
  });

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
