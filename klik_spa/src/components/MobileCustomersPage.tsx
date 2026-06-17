"use client"

import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import CustomersPage from "./CustomersPage"
import BottomNavigation from "./BottomNavigation"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { getPartyLabels } from "../utils/partyLabels"

export default function MobileCustomersPage() {
  const navigate = useNavigate()
  const { posDetails } = usePOSDetails()
  const isHospitalPharmacy = posDetails?.custom_is_hospital_pharmacy === 1 ||
    posDetails?.custom_is_hospital_pharmacy === true ||
    posDetails?.custom_is_hospital_pharmacy === "1"
  const party = getPartyLabels(isHospitalPharmacy)

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ArrowLeft className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            </button>
            <img src="/assets/klik_pos/images/ROSE_LOGO.png" alt="KLiK PoS" className="w-8 h-8 rounded-full object-cover" />
            <span className="font-bold text-xl text-gray-900 dark:text-white">{party.plural}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pb-20 overflow-hidden">
        <CustomersPage />
      </div>

      {/* Bottom Navigation */}
      <BottomNavigation />
    </div>
  )
}
