import EmployeeDispenseModal from "./EmployeeDispenseModal";
import { useCartStore } from "../stores/cartStore";
import { useUiStore } from "../stores/uiStore";

export default function EmployeeDispenseHost() {
  const cartItems = useCartStore((state) => state.cartItems);
  const clearCart = useCartStore((state) => state.clearCart);
  const employeeDispenseOpen = useUiStore((state) => state.employeeDispenseOpen);
  const closeEmployeeDispense = useUiStore((state) => state.closeEmployeeDispense);

  return (
    <EmployeeDispenseModal
      isOpen={employeeDispenseOpen}
      onClose={closeEmployeeDispense}
      cartItems={cartItems}
      onSuccess={clearCart}
    />
  );
}
