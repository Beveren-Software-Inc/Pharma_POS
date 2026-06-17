import { Receipt, Grid3X3, BarChart3, Users, MonitorX } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { usePOSDetails } from "../hooks/usePOSProfile"

export default function RetailSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { posDetails } = usePOSDetails()

  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
    posDetails?.custom_is_hospital_pharmacy === true ||
    posDetails?.custom_is_hospital_pharmacy === "1"

  const menuItems = [
    { icon: Grid3X3, path: "/pos", label: "POS" },
    { icon: Receipt, path: "/invoice", label: "InvoiceHistory" },
    { icon: Users, path: "/customers", label: "Customers" },
    ...(!isHospitalPharmacy ? [{ icon: BarChart3, path: "/dashboard", label: "Dashboard" }] : []),
    { icon: MonitorX, path: "/closing_shift", label: "Closing Shift" },
  ]

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos"
    }
    return location.pathname.startsWith(path)
  }

  return (
<div className="hidden lg:flex fixed h-screen w-20 top-0 left-0 bg-white dark:bg-gray-800 shadow-lg flex-col border-r border-gray-200 dark:border-gray-700 z-50">
      <div
          className="h-20 flex items-center justify-center border-gray-100 dark:border-gray-700 cursor-pointer active:scale-90 transition-transform duration-150"
          onClick={() => navigate("/")}
        >
          <img
            src="/assets/klik_pos/images/ROSE_LOGO.png"
            alt="KLiK PoS"
            className="w-12 h-12 rounded-full object-cover"
          />
        </div>

      <div className="flex-1 flex flex-col items-center py-6 space-y-4">
        {menuItems.map((item, index) => (
          <button
            key={index}
            onClick={() => navigate(item.path)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-90 duration-150 ${
              isActive(item.path)
                ? "bg-beveren-100 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                : "text-beveren-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            title={item.label}
          >
            <item.icon size={20} />
          </button>
        ))}
      </div>
    </div>
  )
}
