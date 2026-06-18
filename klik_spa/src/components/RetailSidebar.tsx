import { Receipt, Grid3X3, BarChart3, Users, MonitorX } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { getPartyLabels } from "../utils/partyLabels"

export default function RetailSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { posDetails } = usePOSDetails()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
    posDetails?.custom_is_hospital_pharmacy === true ||
    posDetails?.custom_is_hospital_pharmacy === "1"
  const party = getPartyLabels(isHospitalPharmacy)

  const menuItems = useMemo(() => {
    const items = [
      { icon: Grid3X3, path: "/pos", label: "POS" },
      { icon: Receipt, path: "/invoice", label: isHospitalPharmacy ? "Dispense History" : "Invoice History" },
      { icon: Users, path: "/customers", label: party.plural },
    ]
    if (!isHospitalPharmacy) {
      items.push({ icon: BarChart3, path: "/dashboard", label: "Dashboard" })
    }
    items.push({ icon: MonitorX, path: "/closing_shift", label: "Closing Shift" })
    return items
  }, [isHospitalPharmacy, party.plural])

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos" || location.pathname.endsWith("/pos")
    }
    return location.pathname.startsWith(path) || location.pathname.endsWith(path)
  }

  const handleNavigate = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    navigate(path)
  }

  const sidebar = (
    <aside className="hidden lg:flex fixed h-screen w-20 top-0 left-0 bg-white dark:bg-gray-800 shadow-lg flex-col border-r border-gray-200 dark:border-gray-700 z-[10050] pointer-events-auto">
      <Link
        to="/pos"
        onClick={handleNavigate("/pos")}
        className="h-20 flex items-center justify-center border-gray-100 dark:border-gray-700 cursor-pointer active:scale-90 transition-transform duration-150"
      >
        <img
          src="/assets/klik_pos/images/ROSE_LOGO.png"
          alt="KLiK PoS"
          className="w-12 h-12 rounded-full object-cover pointer-events-none"
        />
      </Link>

      <nav className="flex-1 flex flex-col items-center py-6 space-y-4">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={handleNavigate(item.path)}
            title={item.label}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-90 duration-150 ${
              isActive(item.path)
                ? "bg-beveren-100 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                : "text-beveren-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            <item.icon size={20} className="pointer-events-none" />
          </Link>
        ))}
      </nav>
    </aside>
  )

  if (!mounted) return null

  return createPortal(sidebar, document.body)
}
