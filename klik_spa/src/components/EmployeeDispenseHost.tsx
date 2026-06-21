import EmployeeDispenseModal from "./EmployeeDispenseModal";
import { useCartStore } from "../stores/cartStore";
import { useUiStore, runAfterPosSaleComplete, type PosSoldLineItem } from "../stores/uiStore";
import { useProducts } from "../hooks/useProducts";

export default function EmployeeDispenseHost() {
  const cartItems = useCartStore((state) => state.cartItems);
  const employeeDispenseOpen = useUiStore((state) => state.employeeDispenseOpen);
  const closeEmployeeDispense = useUiStore((state) => state.closeEmployeeDispense);
  const { refreshStockOnly } = useProducts();

  const handleSuccess = async () => {
    const soldItems: PosSoldLineItem[] = cartItems
      .map((item) => ({
        itemCode: item.item_code || item.id,
        batchNo: (item as { batch_no?: string }).batch_no,
      }))
      .filter((row) => row.itemCode && row.itemCode !== "undefined");

    await runAfterPosSaleComplete(soldItems);

    if (!useUiStore.getState().afterPosSaleComplete) {
      try {
        await refreshStockOnly();
      } catch (error) {
        console.error("Failed to refresh stock after employee dispense:", error);
      }
    }
  };

  return (
    <EmployeeDispenseModal
      isOpen={employeeDispenseOpen}
      onClose={closeEmployeeDispense}
      cartItems={cartItems}
      onSuccess={handleSuccess}
    />
  );
}
