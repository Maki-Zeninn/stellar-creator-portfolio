/**
 * Authentication store.
 *
 * Issue #1090: The session token is now persisted via expo-secure-store
 * (Keychain/Keystore-backed) instead of plain AsyncStorage. AsyncStorage
 * is not encrypted at rest; expo-secure-store uses platform-native secure
 * storage. Non-sensitive fields (user) remain in AsyncStorage for fast access.
 *
 * `isHydrated` starts `false` and flips to `true` once the persisted state
 * has been rehydrated, so the app can gate rendering until the auth state
 * is known.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthState } from './types';

/** AsyncStorage key under which non-sensitive auth fields are persisted. */
export const AUTH_STORAGE_KEY = '@stellar/auth';
/** SecureStore key for the sensitive session token. */
export const AUTH_TOKEN_KEY = 'stellar_auth_token';

/**
 * Custom storage adapter: splits sensitive token into SecureStore,
 * keeps non-sensitive fields in AsyncStorage.
 */
const secureHybridStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const asyncData = await AsyncStorage.getItem(name);
    if (!asyncData) return null;
    try {
      const parsed = JSON.parse(asyncData);
      // Restore token from SecureStore if present
      if (parsed && parsed.isAuthenticated) {
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (token) {
          parsed.token = token;
        }
      }
      return JSON.stringify(parsed);
    } catch {
      return asyncData;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value);
      // Store token in SecureStore, strip it from AsyncStorage payload
      if (parsed && parsed.token) {
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, parsed.token);
        parsed.token = null;
      }
      await AsyncStorage.setItem(name, JSON.stringify(parsed));
    } catch {
      await AsyncStorage.setItem(name, value);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    await AsyncStorage.removeItem(name);
  },
};

/**
 * Hook to access the authentication store.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isHydrated: false,
      setUser: (user, token) => set({ user, token, isAuthenticated: true }),
      clearAuth: () =>
        set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => secureHybridStorage),
      // Persist user, token, and isAuthenticated (token goes to SecureStore)
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ isHydrated: true });
      },
    },
  ),
);
