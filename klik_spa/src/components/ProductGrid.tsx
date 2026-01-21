"use client"

import { useEffect, useRef, useCallback } from "react"
import ProductCard from "./ProductCard"
import ProductLineView from "./ProductLineView"
import type { MenuItem } from "../../types"

interface ProductGridProps {
  items: MenuItem[]
  onAddToCart: (item: MenuItem) => void
  isMobile?: boolean
  scannerOnly?: boolean
  viewMode?: 'grid' | 'list'
  // Infinite scroll props
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  totalCount?: number
}

export default function ProductGrid({
  items,
  onAddToCart,
  isMobile = false,
  scannerOnly = false,
  viewMode = 'grid',
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  totalCount = 0,
}: ProductGridProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Intersection Observer for infinite scroll
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0]
    if (target.isIntersecting && hasMore && !isLoadingMore && onLoadMore) {
      onLoadMore()
    }
  }, [hasMore, isLoadingMore, onLoadMore])

  useEffect(() => {
    const option = {
      root: null,
      rootMargin: "200px", // Load more before reaching the bottom
      threshold: 0,
    }

    const observer = new IntersectionObserver(handleObserver, option)

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current)
      }
    }
  }, [handleObserver])

  // If viewMode is 'list', render the line view
  if (viewMode === 'list') {
    return (
      <div className="flex flex-col">
        <ProductLineView items={items} onAddToCart={onAddToCart} isMobile={isMobile} scannerOnly={scannerOnly} />

        {/* Load more trigger and indicator */}
        {onLoadMore && (
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {isLoadingMore && (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-beveren-600"></div>
                <span className="text-gray-500 dark:text-gray-400 text-sm">Loading more items...</span>
              </div>
            )}
            {!isLoadingMore && hasMore && (
              <span className="text-gray-400 dark:text-gray-500 text-sm">
                Showing {items.length} of {totalCount} items
              </span>
            )}
            {!hasMore && items.length > 0 && (
              <span className="text-gray-400 dark:text-gray-500 text-sm">
                All {items.length} items loaded
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  // Default grid view
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No items found</h3>
          <p className="text-gray-500 dark:text-gray-400">Try adjusting your search or filters</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${isMobile ? "p-4" : "p-6"} bg-gray-50 dark:bg-gray-900`}>
      <div
        className={`grid gap-4 ${
          isMobile
            ? "grid-cols-2 sm:grid-cols-3"
            : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        }`}
      >
        {items.map((item) => (
          <ProductCard key={item.id} item={item} onAddToCart={onAddToCart} isMobile={isMobile} scannerOnly={scannerOnly} />
        ))}
      </div>

      {/* Load more trigger and indicator */}
      {onLoadMore && (
        <div ref={loadMoreRef} className="py-6 flex justify-center">
          {isLoadingMore && (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-beveren-600"></div>
              <span className="text-gray-500 dark:text-gray-400 text-sm">Loading more items...</span>
            </div>
          )}
          {!isLoadingMore && hasMore && (
            <span className="text-gray-400 dark:text-gray-500 text-sm">
              Showing {items.length} of {totalCount} items • Scroll for more
            </span>
          )}
          {!hasMore && items.length > 0 && totalCount > 0 && (
            <span className="text-gray-400 dark:text-gray-500 text-sm">
              All {items.length} items loaded
            </span>
          )}
        </div>
      )}
    </div>
  )
}
