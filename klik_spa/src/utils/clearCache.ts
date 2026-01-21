import { useCartStore } from '../stores/cartStore';
import { clearDraftInvoiceCache } from './draftInvoiceCache';

// Cache keys used throughout the application
const CACHE_KEYS = {
  PRODUCTS: 'klik_pos_products_cache',
  PRODUCTS_EXPIRY: 'klik_pos_products_cache_expiry',
  DRAFT_INVOICE: 'draft-invoice-cache',
  CART: 'beveren-cart-storage',
};


export function clearAllCache(): void {
  try {
    console.log('🧹 Clearing all application cache...');

    // Clear product cache
    localStorage.removeItem(CACHE_KEYS.PRODUCTS);
    localStorage.removeItem(CACHE_KEYS.PRODUCTS_EXPIRY);
    console.log('✅ Product cache cleared');

    // Clear draft invoice cache
    clearDraftInvoiceCache();
    console.log('✅ Draft invoice cache cleared');

    // Clear cart cache
    localStorage.removeItem(CACHE_KEYS.CART);
    console.log('✅ Cart cache cleared');

    // Clear cart state in memory
    const { clearCart } = useCartStore.getState();
    clearCart();
    console.log('✅ Cart state cleared');

    // Clear any other app-related localStorage items
    // (excluding theme, language, and other user preferences)
    const keysToKeep = [
      'theme',
      'language',
      'i18n',
      'auth-token',
      'user-session',
    ];

    const allKeys = Object.keys(localStorage);
    const appKeys = allKeys.filter(key =>
      key.startsWith('klik_pos_') ||
      key.startsWith('beveren-') ||
      key.startsWith('draft-') ||
      (key.includes('cache') && !keysToKeep.includes(key))
    );

    appKeys.forEach(key => {
      localStorage.removeItem(key);
      console.log(`✅ Cleared cache key: ${key}`);
    });

    console.log('🎉 All cache cleared successfully!');

  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    throw error;
  }
}

/**
 * Clears backend cache via API call
 */
async function clearBackendCache(): Promise<void> {
  try {
    console.log('🧹 Clearing backend cache...');

    const response = await fetch('/api/method/klik_pos.api.cache.clear_backend_cache', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      credentials: 'include'
    });

    const data = await response.json();

    if (data.message?.success) {
      console.log('✅ Backend cache cleared successfully');
    } else {
      console.warn('⚠️ Backend cache clear failed:', data.message?.error || 'Unknown error');
    }
  } catch (error) {
    console.error('❌ Error clearing backend cache:', error);
  }
}

/**
 * Clears cache and reloads the page to ensure fresh data
 */
export async function clearCacheAndReload(): Promise<void> {
  try {
    clearAllCache();

    await clearBackendCache();

    // Show a brief message before reload
    console.log('🔄 Reloading page with fresh data...');

    // Reload the page after a short delay to ensure cache is cleared
    setTimeout(() => {
      window.location.reload();
    }, 100);

  } catch (error) {
    console.error('❌ Error during cache clear and reload:', error);
    window.location.reload();
  }
}
