import { create } from "zustand";
import { useCartStore } from "./cartStore";

export type PosSoldLineItem = {
  itemCode: string;
  batchNo?: string;
};

type AfterPosSaleCompleteFn = (soldItems: PosSoldLineItem[]) => void | Promise<void>;

interface UiStore {
  employeeDispenseOpen: boolean;
  openEmployeeDispense: () => void;
  closeEmployeeDispense: () => void;
  afterPosSaleComplete: AfterPosSaleCompleteFn | null;
  setAfterPosSaleComplete: (handler: AfterPosSaleCompleteFn | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  employeeDispenseOpen: false,
  openEmployeeDispense: () => set({ employeeDispenseOpen: true }),
  closeEmployeeDispense: () => set({ employeeDispenseOpen: false }),
  afterPosSaleComplete: null,
  setAfterPosSaleComplete: (handler) => set({ afterPosSaleComplete: handler }),
}));

export async function runAfterPosSaleComplete(soldItems: PosSoldLineItem[]) {
  const handler = useUiStore.getState().afterPosSaleComplete;
  if (handler) {
    await handler(soldItems);
    return;
  }
  useCartStore.getState().clearCart();
}
