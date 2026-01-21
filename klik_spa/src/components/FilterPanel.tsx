"use client"

import { useState } from "react"
import { Check } from "lucide-react"

// Empty categories array - replace with real data when available
type Category = { id: string; name: string; icon?: string }
const categories: Category[] = []

interface FilterPanelProps {
  filterOptions: {
    priceRange: [number, number]
    availability: string
    discount: boolean
  }
  onFilterChange: (newFilters: Partial<FilterPanelProps["filterOptions"]>) => void
  onClose: () => void
}

export default function FilterPanel({ filterOptions, onFilterChange, onClose }: FilterPanelProps) {

  const [maxPrice, setMaxPrice] = useState(filterOptions.priceRange[1])
  const [availability, setAvailability] = useState(filterOptions.availability)
  const [discount, setDiscount] = useState(filterOptions.discount)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  const [minPrice, setMinPrice] = useState(filterOptions.priceRange[0])

  const handleApplyFilters = () => {
    onFilterChange({
      priceRange: [minPrice, maxPrice],
      availability,
      discount,
    })
    onClose()
  }

  const handleResetFilters = () => {
    setMinPrice(0)
    setMaxPrice(100)
    setAvailability("all")
    setDiscount(false)
    setSelectedCategories([])
    onFilterChange({
      priceRange: [0, 100],
      availability: "all",
      discount: false,
    })
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* header omitted for brevity */}
      <div className="p-4 space-y-6">
        {/* Discount */}
        <div>
          <h4 className="font-medium mb-2">Discount</h4>
          <button
            onClick={() => setDiscount(!discount)}
            className={`px-3 py-2 rounded-lg border flex items-center ${
              discount ? "bg-beveren-50 border-beveren-300 text-beveren-600" : "border-gray-300 text-gray-700"
            }`}
          >
            <div
              className={`w-5 h-5 rounded border mr-2 flex items-center justify-center ${
                discount ? "bg-beveren-600 border-beveren-600" : "border-gray-400"
              }`}
            >
              {discount && <Check size={14} className="text-white" />}
            </div>
            Show only discounted items
          </button>
        </div>

        {/* Categories (simplified) */}
        <div>
          <h4 className="font-medium mb-2">Categories</h4>
          <div className="flex flex-wrap gap-2">
            {categories.slice(1, 5).map((category) => (
              <button
                key={category.id}
                onClick={() => {
                  if (selectedCategories.includes(category.id)) {
                    setSelectedCategories(selectedCategories.filter((id) => id !== category.id))
                  } else {
                    setSelectedCategories([...selectedCategories, category.id])
                  }
                }}
                className={`px-2 py-1 rounded-lg border text-sm ${
                  selectedCategories.includes(category.id)
                    ? "bg-beveren-50 border-beveren-300 text-beveren-600"
                    : "border-gray-300 text-gray-700"
                }`}
              >
                {category.icon} {category.name}
              </button>
            ))}
            <button className="px-2 py-1 rounded-lg border text-sm border-gray-300 text-gray-700">+ More</button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between mt-6">
        <button onClick={handleResetFilters} className="px-4 py-2 border rounded-lg">Reset</button>
        <button onClick={handleApplyFilters} className="px-4 py-2 bg-beveren-600 text-white rounded-lg">Apply</button>
      </div>
    </div>
  )
}
