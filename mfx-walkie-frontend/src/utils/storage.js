// Safe localStorage wrapper to prevent crashes in private browsing mode or WebViews where localStorage is blocked
const isLocalStorageAvailable = () => {
  try {
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
};

const hasLocalStorage = isLocalStorageAvailable();

// Simple in-memory fallback
const memoryStorage = {};

export const safeStorage = {
  getItem: (key) => {
    if (hasLocalStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        console.warn(`[SafeStorage] Error reading key "${key}" from localStorage:`, e);
      }
    }
    return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null;
  },

  setItem: (key, value) => {
    if (hasLocalStorage) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch (e) {
        console.warn(`[SafeStorage] Error writing key "${key}" to localStorage:`, e);
      }
    }
    memoryStorage[key] = String(value);
  },

  removeItem: (key) => {
    if (hasLocalStorage) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch (e) {
        console.warn(`[SafeStorage] Error removing key "${key}" from localStorage:`, e);
      }
    }
    delete memoryStorage[key];
  }
};
