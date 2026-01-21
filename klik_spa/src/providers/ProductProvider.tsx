import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { MenuItem } from '../../types';
import { useAuth } from '../hooks/useAuth';

interface ProductContextType {
  products: MenuItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshingStock: boolean;
  isSearching: boolean;
  error: string | null;
  refetchProducts: () => Promise<void>;
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

const ProductContext = createContext<ProductContextType | undefined>(undefined);

interface ProductProviderProps {
  children: ReactNode;
}

// Pagination configuration
const PAGE_SIZE = 1000; // Initial load size
const LOAD_MORE_SIZE = 500; // Size for subsequent loads

export function ProductProvider({ children }: ProductProviderProps) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isRefreshingStock, setIsRefreshingStock] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Pagination state
  const [totalCount, setTotalCount] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Ref to track if we're currently searching (to prevent race conditions)
  const searchAbortController = useRef<AbortController | null>(null);

  // Fetch products from API with pagination
  const fetchProductsFromAPI = async (
    limit: number = PAGE_SIZE,
    offset: number = 0,
    search: string = '',
    category: string = ''
  ): Promise<{
    items: MenuItem[];
    total_count: number;
    has_more: boolean;
  }> => {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      if (search) {
        params.append('search', search);
      }
      if (category && category !== 'all') {
        params.append('category', category);
      }
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_items_with_balance_and_price?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const resData = await response.json();
      console.log('[Products] Raw response payload', resData);

      const message = resData?.message ?? resData;

      // Common shape: { items: [...], total_count, has_more }
      if (message && typeof message === 'object') {
        const maybeItems =
          (message as any).items ??
          (message as any).data ??
          (message as any).results ??
          (resData as any).items;

        if (maybeItems !== undefined) {
          const itemsArray = Array.isArray(maybeItems) ? maybeItems : Object.values(maybeItems);
          console.log('[Products] Parsed items array length', itemsArray.length, {
            total_count: (message as any).total_count,
            has_more: (message as any).has_more,
            offset,
            limit,
            search,
          });
          return {
            items: itemsArray,
            total_count: (message as any).total_count ?? itemsArray.length ?? 0,
            has_more: Boolean((message as any).has_more),
          };
        }

        // If items missing but counts exist, return empty array (fail-open)
        if ((message as any).total_count !== undefined || (message as any).has_more !== undefined) {
          console.warn('[Products] No items but counts present', {
            total_count: (message as any).total_count,
            has_more: (message as any).has_more,
            offset,
            limit,
            search,
          });
          return {
            items: [],
            total_count: (message as any).total_count ?? 0,
            has_more: Boolean((message as any).has_more),
          };
        }
      }

      // Old shape: { message: [...] }
      if (Array.isArray(message)) {
        return {
          items: message,
          total_count: message.length,
          has_more: false,
        };
      }

      // Defensive: double-wrapped { message: { items: ... } }
      if (message?.message) {
        const inner = message.message;
        const innerItems = inner.items ?? inner.data ?? inner.results;
        if (innerItems !== undefined) {
          const itemsArray = Array.isArray(innerItems) ? innerItems : Object.values(innerItems);
          console.log('[Products] Parsed inner items array length', itemsArray.length, {
            total_count: inner.total_count,
            has_more: inner.has_more,
            offset,
            limit,
            search,
          });
          return {
            items: itemsArray,
            total_count: inner.total_count ?? itemsArray.length ?? 0,
            has_more: Boolean(inner.has_more),
          };
        }
        if (inner.total_count !== undefined || inner.has_more !== undefined) {
          console.warn('[Products] No inner items but counts present', {
            total_count: inner.total_count,
            has_more: inner.has_more,
            offset,
            limit,
            search,
          });
          return {
            items: [],
            total_count: inner.total_count ?? 0,
            has_more: Boolean(inner.has_more),
          };
        }
      }

      console.error('Invalid response format:', resData, { offset, limit, search, category });
      // Fail-open: return empty structure to avoid blocking UI while we inspect
      return {
        items: [],
        total_count: 0,
        has_more: false,
      };
    } catch (err) {
      console.error('[Products] fetchProductsFromAPI error (fail-open)', err, { offset, limit, search, category });
      return {
        items: [],
        total_count: 0,
        has_more: false,
      };
    }
  };

  // Fetch only stock updates - with fallback to batch API
  const fetchStockUpdates = async (): Promise<Record<string, number>> => {
    try {
      // For large catalogs, only update stock for currently loaded items
      const itemCodes = products.map(p => p.id).join(',');
      if (!itemCodes) return {};

      const batchResponse = await fetch(
        `/api/method/klik_pos.api.item.get_items_stock_batch?item_codes=${encodeURIComponent(itemCodes)}`
      );

      if (batchResponse.ok) {
        const batchData = await batchResponse.json();
        if (batchData?.message && typeof batchData.message === 'object') {
          return batchData.message;
        }
      }
      return {};
    } catch (error) {
      console.error('Error fetching stock updates:', error);
      return {};
    }
  };

  // Initial fetch of products with pagination
  const fetchProducts = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    setSearchQuery(''); // Clear search on initial fetch
    backgroundLoadStartedRef.current = false; // Reset background load flag

    try {
      const result = await fetchProductsFromAPI(PAGE_SIZE, 0);

      setProducts(result.items);
      setTotalCount(result.total_count);
      setHasMore(result.has_more);
      setCurrentOffset(result.items.length);
      setLastUpdated(new Date());

      console.log(`Products loaded: ${result.items.length} of ${result.total_count} items`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching products:", error);
      // Fail-open: don't block UI with "Invalid response format"
      if (error.message && error.message.includes("Invalid response format")) {
        setError(null);
      } else {
        setError(error.message || "Unknown error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Ref to track if background loading has been started
  const backgroundLoadStartedRef = useRef(false);

  // Auto-load remaining items in background after initial load
  useEffect(() => {
    // Only auto-load once after initial load completes:
    // - Initial load just finished (isLoading is false)
    // - Not searching
    // - Has more items to load
    // - Haven't started background load yet
    if (isLoading || isLoadingMore || searchQuery || !hasMore || backgroundLoadStartedRef.current) {
      return;
    }

    // Mark as started to prevent re-triggering
    backgroundLoadStartedRef.current = true;

    // Small delay to let UI render first batch
    const timer = setTimeout(() => {
      const loadRemaining = async () => {
        // Use functional state updates to always get latest values
        let offset = currentOffset;
        let stillHasMore = hasMore;
        let targetTotal = totalCount;

        while (stillHasMore && !searchQuery) {
          try {
            // Check if we've reached the target
            if (offset >= targetTotal) {
              break;
            }

            console.log(`[Background] Loading more items from offset ${offset}...`);
            const result = await fetchProductsFromAPI(LOAD_MORE_SIZE, offset);

            if (result.items.length === 0) {
              break;
            }

            setProducts(prev => {
              // Avoid duplicates
              const existingIds = new Set(prev.map(p => p.id));
              const newItems = result.items.filter(item => !existingIds.has(item.id));
              return [...prev, ...newItems];
            });

            offset += result.items.length;
            stillHasMore = result.has_more;
            setHasMore(result.has_more);
            setCurrentOffset(offset);

            // Update target total if it changed
            if (result.total_count > targetTotal) {
              targetTotal = result.total_count;
            }

            console.log(`[Background] Loaded ${result.items.length} more items. Total: ${offset} of ${targetTotal}`);

            // Small delay between batches to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error('[Background] Error loading more items:', error);
            break;
          }
        }

        console.log(`[Background] Finished loading all items. Total: ${offset}`);
      };

      loadRemaining();
    }, 500); // Wait 500ms after initial load

    return () => {
      clearTimeout(timer);
    };
  }, [isLoading, hasMore, searchQuery, currentOffset, totalCount]); // Trigger when initial load completes

  // Reset background load flag when search changes or products are refetched
  useEffect(() => {
    if (searchQuery) {
      backgroundLoadStartedRef.current = false;
    }
  }, [searchQuery]);

  // Load more products (infinite scroll)
  const loadMoreProducts = useCallback(async () => {
    if (isLoadingMore || !hasMore || searchQuery) return;

    setIsLoadingMore(true);

    try {
      const result = await fetchProductsFromAPI(LOAD_MORE_SIZE, currentOffset);

      setProducts(prev => {
        // Avoid duplicates by filtering out items that already exist
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = result.items.filter(item => !existingIds.has(item.id));
        return [...prev, ...newItems];
      });

      setCurrentOffset(prev => prev + result.items.length);
      setHasMore(result.has_more);

      console.log(`Loaded ${result.items.length} more products. Total: ${currentOffset + result.items.length}`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error loading more products:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, currentOffset, searchQuery]);

  // Server-side search
  const searchProducts = useCallback(async (query: string) => {
    // Cancel previous search request
    if (searchAbortController.current) {
      searchAbortController.current.abort();
    }

    const trimmedQuery = query.trim();
    setSearchQuery(trimmedQuery);

    // If empty query, reset to initial products
    if (!trimmedQuery) {
      setIsSearching(false);
      fetchProducts();
      return;
    }

    setIsSearching(true);
    searchAbortController.current = new AbortController();

    try {
      // Search with larger limit to get more results
      const result = await fetchProductsFromAPI(500, 0, trimmedQuery);

      setProducts(result.items);
      setTotalCount(result.total_count);
      setHasMore(false); // Disable infinite scroll during search
      setCurrentOffset(result.items.length);

      console.log(`Search "${trimmedQuery}" found ${result.items.length} items`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error searching products:", error);
      }
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Clear search and reset to initial products
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    fetchProducts();
  }, []);

  // Background stock update
  const updateStockInBackground = async () => {
    try {
      const stockUpdates = await fetchStockUpdates();
      if (Object.keys(stockUpdates).length > 0) {
        setProducts(prevProducts =>
          prevProducts.map(product => ({
            ...product,
            available: stockUpdates[product.id] ?? product.available
          }))
        );
        // console.log('Stock updated in background for', Object.keys(stockUpdates).length, 'items');
      }
    } catch (error) {
      console.error('Background stock update failed:', error);
    }
  };

  // Update stock for a specific item
  const updateStockOnly = useCallback((itemCode: string, newStock: number) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === itemCode
          ? { ...product, available: newStock }
          : product
      )
    );
    console.log(`Updated stock for ${itemCode} to ${newStock}`);
  }, []);

  // Update stock for multiple specific items (efficient for post-payment updates)
  const updateStockForItems = useCallback(async (itemCodes: string[]) => {
    if (itemCodes.length === 0) return;

    try {
      // console.log(`Updating stock for ${itemCodes.length} items:`, itemCodes);

      // Create comma-separated string for the API
      const itemCodesString = itemCodes.join(',');

      const response = await fetch(
        `/api/method/klik_pos.api.item.get_items_stock_batch?item_codes=${encodeURIComponent(itemCodesString)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const resData = await response.json();
      // console.log('Batch stock update response:', resData);

      if (resData?.message && typeof resData.message === 'object') {
        const stockUpdates = resData.message;

        setProducts(prevProducts =>
          prevProducts.map(product => ({
            ...product,
            available: stockUpdates[product.id] ?? product.available
          }))
        );

        // console.log(`Updated stock for ${Object.keys(stockUpdates).length} items`);
      }
    } catch (error) {
      console.error('Failed to update stock for items:', error);
      // Don't throw error to avoid breaking the payment flow
    }
  }, []);

  // Update batch quantities for specific items (for real-time batch updates)
  const updateBatchQuantitiesForItems = useCallback(async (itemCodes: string[]) => {
    if (itemCodes.length === 0) return;

    try {
      // console.log(`Updating batch quantities for ${itemCodes.length} items:`, itemCodes);

      // Update batch quantities for each item individually
      const batchUpdatePromises = itemCodes.map(async (itemCode) => {
        try {
          const response = await fetch(
            `/api/method/klik_pos.api.item.get_batch_nos_with_qty?item_code=${encodeURIComponent(itemCode)}`
          );
          const resData = await response.json();
          // console.log(`Batch API response for ${itemCode}:`, resData);

          if (resData?.message && Array.isArray(resData.message)) {
            // console.log(`Valid batch data for ${itemCode}:`, resData.message);
            return { itemCode, batches: resData.message };
          }
          console.log(`No valid batch data for ${itemCode}`);
          return null;
        } catch (error) {
          console.error(`Failed to update batch quantities for ${itemCode}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchUpdatePromises);
      const validResults = batchResults.filter(result => result !== null);

      if (validResults.length > 0) {
        // console.log(`Updated batch quantities for ${validResults.length} items`);
        // console.log('Dispatching batchQuantitiesUpdated event with data:', validResults);
        // Trigger a custom event to notify components about batch updates
        window.dispatchEvent(new CustomEvent('batchQuantitiesUpdated', {
          detail: { updatedItems: validResults }
        }));
      } else {
        console.log('No valid batch results to dispatch');
      }
    } catch (error) {
      console.error('Failed to update batch quantities for items:', error);
    }
  }, []);

  const refetchProducts = async () => {
    // console.log("Force refreshing products...");
    await fetchProducts(true);
  };

  // Lightweight stock-only refresh - much faster than full reload
  const refreshStockOnly = async () => {
    // console.log("Refreshing stock only (lightweight)...");
    setIsRefreshingStock(true);
    try {
      const stockUpdates = await fetchStockUpdates();
      if (Object.keys(stockUpdates).length > 0) {
        setProducts(prevProducts =>
          prevProducts.map(product => ({
            ...product,
            available: stockUpdates[product.id] ?? product.available
          }))
        );
        // console.log(`✅ Stock refreshed for ${Object.keys(stockUpdates).length} items - cashier can see updated availability`);
        setLastUpdated(new Date());
        return true; // Success
      }
      console.log("No stock updates needed - all items are current");
      return false; // No updates
    } catch (error) {
      console.error('❌ Stock-only refresh failed:', error);
      // Don't fallback to full refresh automatically - let the user decide
      console.log("Stock refresh failed - user can manually refresh if needed");
      return false; // Failed
    } finally {
      setIsRefreshingStock(false);
    }
  };

  useEffect(() => {
    // Don't fetch products until authentication is complete
    if (authLoading) {
      return;
    }

    // If not authenticated, don't fetch products
    if (!isAuthenticated) {
      setIsLoading(false);
      setError("Authentication required to load products");
      return;
    }

    // Authentication is complete, fetch products
    fetchProducts();

    // Set up periodic stock updates as fallback
    const stockUpdateInterval = setInterval(updateStockInBackground, 30000); // Every 30 seconds

    return () => {
      clearInterval(stockUpdateInterval);
    };
  }, [isAuthenticated, authLoading]);

  const value: ProductContextType = {
    products,
    isLoading,
    isLoadingMore,
    isRefreshingStock,
    isSearching,
    error,
    refetchProducts,
    refreshStockOnly,
    updateStockOnly,
    updateStockForItems,
    updateBatchQuantitiesForItems,
    loadMoreProducts,
    searchProducts,
    clearSearch,
    count: products.length,
    totalCount,
    hasMore,
    lastUpdated,
    searchQuery,
  };

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProducts() {
  const context = useContext(ProductContext);
  if (context === undefined) {
    throw new Error('useProducts must be used within a ProductProvider');
  }
  return context;
}
