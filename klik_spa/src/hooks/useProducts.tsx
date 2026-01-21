
// import { useFrappeGetDocList } from "frappe-react-sdk";
import type { MenuItem } from "../../types";
import { useEffect, useState } from "react";
import { useProducts as useProductsContext } from "../providers/ProductProvider";

interface UseProductsReturn {
  products: MenuItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshingStock: boolean;
  isSearching: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refreshStockOnly: () => Promise<boolean>;
  updateStockOnly: (itemCode: string, newStock: number) => void;
  updateStockForItems: (itemCodes: string[]) => Promise<void>;
  updateBatchQuantitiesForItems: (itemCodes: string[]) => Promise<void>;
  loadMoreProducts: () => Promise<void>;
  searchProducts: (query: string) => Promise<void>;
  clearSearch: () => void;
  count: number;
  totalCount: number;
  hasMore: boolean;
  lastUpdated: Date | null;
  searchQuery: string;
}

type Batch = {
  batch_id: string;
  qty: number;
};

type UseBatchReturn = {
  batches: Batch[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  count: number;
  updateBatchQuantities: (itemCode: string) => Promise<void>;
};

// Re-export the context hook for backward compatibility
export function useProducts(): UseProductsReturn {
  const context = useProductsContext();
  return {
    products: context.products,
    isLoading: context.isLoading,
    isLoadingMore: context.isLoadingMore,
    isRefreshingStock: context.isRefreshingStock,
    isSearching: context.isSearching,
    error: context.error,
    refetch: context.refetchProducts,
    refreshStockOnly: context.refreshStockOnly,
    updateStockOnly: context.updateStockOnly,
    updateStockForItems: context.updateStockForItems,
    updateBatchQuantitiesForItems: context.updateBatchQuantitiesForItems,
    loadMoreProducts: context.loadMoreProducts,
    searchProducts: context.searchProducts,
    clearSearch: context.clearSearch,
    count: context.products.length,
    totalCount: context.totalCount,
    hasMore: context.hasMore,
    lastUpdated: context.lastUpdated,
    searchQuery: context.searchQuery,
  };
}


export function useBatchData(itemCode: string, warehouse: string): UseBatchReturn {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchBatches = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.batch.get_batch_nos_with_qty?item_code=${encodeURIComponent(itemCode)}&warehouse=${encodeURIComponent(warehouse)}`
      );
      const resData = await response.json();

      if (resData?.message && Array.isArray(resData.message)) {
        setBatches(resData.message);
      } else {
        throw new Error("Invalid response format");
      }

      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching batch data:", error);
      setErrorMessage(error.message || "Unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (itemCode && warehouse) {
      fetchBatches();
    }
  }, [itemCode, warehouse]);

  // Function to update batch quantities for a specific item
  const updateBatchQuantities = async (targetItemCode: string): Promise<void> => {
    if (targetItemCode !== itemCode) return; // Only update if it's the same item

    try {
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_batch_nos_with_qty?item_code=${encodeURIComponent(targetItemCode)}`
      );
      const resData = await response.json();

      if (resData?.message && Array.isArray(resData.message)) {
        setBatches(resData.message);
        console.log(`Updated batch quantities for ${targetItemCode}:`, resData.message);
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error updating batch quantities:", error);
    }
  };

  return {
    batches,
    isLoading,
    error: errorMessage,
    refetch: fetchBatches,
    count: batches.length,
    updateBatchQuantities,
  };
}
