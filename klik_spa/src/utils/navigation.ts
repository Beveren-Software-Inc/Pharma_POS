import type { NavigateFunction } from "react-router-dom";
import { cleanupStaleOverlays } from "./cleanupOverlays";
import { useUiStore } from "../stores/uiStore";

const POS_SPA_BASE = "/klik_pos";

/** Fired before SPA route changes so POS views can close local modals/dropdowns. */
export const POS_BEFORE_NAVIGATE_EVENT = "pos:before-navigate";

function resolvePosPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${POS_SPA_BASE}${normalized}`;
}

function isOnPosPath(path: string): boolean {
  const target = resolvePosPath(path);
  const current = window.location.pathname;
  return current === target || current.startsWith(`${target}/`);
}

/** Clear overlays/modals that can block navigation while the cart still has items. */
export function prepareForPosNavigation(): void {
  cleanupStaleOverlays();
  useUiStore.getState().closeEmployeeDispense();
  window.dispatchEvent(new CustomEvent(POS_BEFORE_NAVIGATE_EVENT));
}

/** Navigate to an in-app route without requiring an empty cart. */
export function navigateToPosRoute(navigate: NavigateFunction, path: string): void {
  if (isOnPosPath(path)) return;

  prepareForPosNavigation();
  navigate(path);

  // If the SPA router is busy (heavy cart work), fall back to a full route change.
  window.setTimeout(() => {
    if (!isOnPosPath(path)) {
      window.location.assign(resolvePosPath(path));
    }
  }, 120);
}

/** Navigate back to the ERPNext desk from the POS SPA. */
export function navigateToDesk(): void {
  prepareForPosNavigation();
  window.location.href = "/desk";
}
