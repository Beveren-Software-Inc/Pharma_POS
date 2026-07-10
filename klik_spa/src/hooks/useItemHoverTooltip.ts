import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuItem } from "../../types";
import { itemHasBatchNo } from "../utils/batch";

type HoverItem = MenuItem & {
  custom_strength?: string | null;
  custom_pharmaceutical_form?: string | null;
  custom_number_of_pack?: number | null;
  custom_pack_size?: string | null;
  custom_route_of_administration?: string | null;
};

export function useItemHoverTooltip(isPharmacy: boolean) {
  const [hoverItem, setHoverItem] = useState<HoverItem | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).lastMouseX = e.clientX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).lastMouseY = e.clientY;
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const itemShowsHoverTooltip = useCallback(
    (item: HoverItem) => {
      const hasPharmacyData =
        isPharmacy &&
        !!(
          item.custom_strength ||
          item.custom_pharmaceutical_form ||
          item.custom_number_of_pack !== null ||
          item.custom_number_of_pack !== undefined ||
          item.custom_pack_size ||
          item.custom_route_of_administration
        );
      return hasPharmacyData || itemHasBatchNo(item);
    },
    [isPharmacy]
  );

  const openHoverTooltip = useCallback(
    (item: HoverItem) => {
      if (!itemShowsHoverTooltip(item)) return;
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setHoverItem(item);
      setShowTooltip(true);
    },
    [itemShowsHoverTooltip]
  );

  const closeHoverTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mouseX = (window as any).lastMouseX || 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mouseY = (window as any).lastMouseY || 0;
      const hoveredElement = document.elementFromPoint(mouseX, mouseY);
      const isOverProduct = hoveredElement?.closest("[data-item-hover-target]");
      const isOverModal = hoveredElement?.closest(".pharmacy-tooltip");

      if (!isOverProduct && !isOverModal) {
        setShowTooltip(false);
        setHoverItem(null);
      }
    }, 500);
  }, []);

  const dismissHoverTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setShowTooltip(false);
    setHoverItem(null);
  }, []);

  return {
    hoverItem,
    showTooltip,
    itemShowsHoverTooltip,
    openHoverTooltip,
    closeHoverTooltip,
    dismissHoverTooltip,
  };
}
