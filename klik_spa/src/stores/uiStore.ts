import { create } from "zustand";

interface UiStore {
  employeeDispenseOpen: boolean;
  openEmployeeDispense: () => void;
  closeEmployeeDispense: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  employeeDispenseOpen: false,
  openEmployeeDispense: () => set({ employeeDispenseOpen: true }),
  closeEmployeeDispense: () => set({ employeeDispenseOpen: false }),
}));
