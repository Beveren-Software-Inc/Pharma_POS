import { Receipt, Grid3X3, BarChart3, Users, MonitorX, UserRound, type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { getPartyLabels } from "../utils/partyLabels"
import { useCartStore } from "../stores/cartStore"
import { useUiStore } from "../stores/uiStore"
import { cleanupStaleOverlays } from "../utils/cleanupOverlays"
import { prepareForPosNavigation } from "../utils/navigation"

type SidebarRouteItem = {
  kind: "route"
  icon: LucideIcon
  path: string
  label: string
}

type SidebarActionItem = {
  kind: "action"
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}

type SidebarItem = SidebarRouteItem | SidebarActionItem

export default function RetailSidebar() {
  const location = useLocation()
  const { posDetails } = usePOSDetails()
  const cartItemCount = useCartStore((state) => state.cartItems.length)
  const openEmployeeDispense = useUiStore((state) => state.openEmployeeDispense)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    cleanupStaleOverlays()
  }, [location.pathname])

  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
    posDetails?.custom_is_hospital_pharmacy === true ||
    posDetails?.custom_is_hospital_pharmacy === "1"
  const isPharmacy = posDetails?.custom_is_pharmacy === 1 ||
    posDetails?.custom_is_pharmacy === true ||
    posDetails?.custom_is_pharmacy === "1"
  const party = getPartyLabels(isHospitalPharmacy)

  const menuItems = useMemo<SidebarItem[]>(() => {
    const items: SidebarItem[] = [
      { kind: "route", icon: Grid3X3, path: "/pos", label: "POS" },
    ]

    if (isPharmacy || isHospitalPharmacy) {
      items.push({
        kind: "action",
        icon: UserRound,
        label: "Dispense to Employee",
        disabled: cartItemCount === 0,
        onClick: () => {
          if (cartItemCount === 0) return;
          openEmployeeDispense();
        },
      })
    }

    items.push(
      { kind: "route", icon: Receipt, path: "/invoice", label: isHospitalPharmacy ? "Dispense History" : "Invoice History" },
      { kind: "route", icon: Users, path: "/customers", label: party.plural },
    )

    if (!isHospitalPharmacy) {
      items.push({ kind: "route", icon: BarChart3, path: "/dashboard", label: "Dashboard" })
    }

    items.push({ kind: "route", icon: MonitorX, path: "/closing_shift", label: "Closing Shift" })
    return items
  }, [cartItemCount, isHospitalPharmacy, isPharmacy, openEmployeeDispense, party.plural])

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos" || location.pathname.endsWith("/pos")
    }
    return location.pathname.startsWith(path) || location.pathname.endsWith(path)
  }

  const sidebar = (
    <aside className="hidden lg:flex fixed h-screen w-20 top-0 left-0 bg-white dark:bg-gray-800 shadow-lg flex-col border-r border-gray-200 dark:border-gray-700 z-[10100] pointer-events-auto isolate">
      <Link
        to="/pos"
        title="POS"
        onMouseDown={() => prepareForPosNavigation()}
        className="h-20 w-full flex items-center justify-center border-gray-100 dark:border-gray-700 cursor-pointer active:scale-90 transition-transform duration-150"
      >
        <img
          src="/assets/klik_pos/images/ROSE_LOGO.png"
          alt="KLiK PoS"
          className="w-12 h-12 rounded-full object-cover pointer-events-none"
        />
      </Link>

      <nav className="flex-1 flex flex-col items-center py-6 space-y-4">
        {menuItems.map((item) => {
          if (item.kind === "route") {
            const active = isActive(item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                onMouseDown={() => prepareForPosNavigation()}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-90 duration-150 ${
                  active
                    ? "bg-beveren-100 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                    : "text-beveren-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                <item.icon size={20} className="pointer-events-none" />
              </Link>
            )
          }

          return (
            <button
              key={item.label}
              type="button"
              title={item.label}
              disabled={item.disabled}
              onClick={item.onClick}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-90 duration-150 ${
                item.disabled
                  ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              }`}
            >
              <item.icon size={20} className="pointer-events-none" />
            </button>
          )
        })}
      </nav>
    </aside>
  )

  if (!mounted) return null

  return createPortal(sidebar, document.body)
}
