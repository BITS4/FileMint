import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ApiError, authApi, isPremiumUser, type AuthUser, type CheckoutResponse, type PlanId, type PremiumPlan } from '@/lib/auth-api';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  sessionExpiresAt: string | null;
  sessionWarningAt: string | null;
  plans: PremiumPlan[];
  loading: boolean;
  error: string | null;
  devCode: string | null;
  hydrated: boolean;
  setError: (error: string | null) => void;
  clearSession: () => void;
  signup: (input: { email: string; username: string; password: string; fullName: string; phone: string }) => Promise<void>;
  checkUsername: (username: string) => Promise<{ valid: boolean; available: boolean; message: string }>;
  verifyEmail: (input: { email: string; code: string }) => Promise<void>;
  resendCode: (email: string) => Promise<string | null>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  confirmPasswordReset: (input: { email: string; code: string; password: string }) => Promise<void>;
  loadPlans: () => Promise<void>;
  buyPlan: (planId: PlanId) => Promise<CheckoutResponse>;
  confirmCheckout: (sessionId: string) => Promise<void>;
  restorePurchases: () => Promise<boolean>;
  manageSubscription: () => Promise<string>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

function sessionExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      sessionExpiresAt: null,
      sessionWarningAt: null,
      plans: [],
      loading: false,
      error: null,
      devCode: null,
      hydrated: false,
      setError: (error) => set({ error }),
      clearSession: () => set({ user: null, token: null, sessionExpiresAt: null, sessionWarningAt: null, error: null, devCode: null }),
      signup: async (input) => {
        set({ loading: true, error: null, devCode: null });
        try {
          const res = await authApi.signup(input);
          set({ user: res.user, devCode: res.devCode ?? null });
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      checkUsername: async (username) => {
        const res = await authApi.checkUsername(username);
        return { valid: res.valid, available: res.available, message: res.message };
      },
      verifyEmail: async (input) => {
        set({ loading: true, error: null });
        try {
          const res = await authApi.verifyEmail(input);
          set({ user: res.user, devCode: null });
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      resendCode: async (email) => {
        set({ loading: true, error: null, devCode: null });
        try {
          const res = await authApi.resendCode(email);
          set({ devCode: res.devCode ?? null });
          return res.devCode ?? null;
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      login: async (input) => {
        set({ loading: true, error: null, devCode: null });
        try {
          const res = await authApi.login(input);
          set({
            user: res.user,
            token: res.session.token,
            sessionExpiresAt: res.session.expiresAt,
            sessionWarningAt: res.session.warningAt,
            devCode: res.devCode ?? null,
          });
        } catch (e) {
          const message = errorMessage(e);
          const data = e instanceof ApiError && typeof e.data === 'object' && e.data ? (e.data as { devCode?: string }) : {};
          set({ error: message, devCode: data.devCode ?? null });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      logout: async () => {
        const token = get().token;
        set({ loading: true });
        try {
          await authApi.logout(token);
        } catch {
          // Logging out must clear local credentials even if the server is offline.
        } finally {
          set({ user: null, token: null, sessionExpiresAt: null, sessionWarningAt: null, error: null, devCode: null, loading: false });
        }
      },
      refreshMe: async () => {
        const { token, sessionExpiresAt } = get();
        if (!token || sessionExpired(sessionExpiresAt)) {
          get().clearSession();
          return;
        }
        try {
          const res = await authApi.me(token);
          set({ user: res.user, sessionExpiresAt: res.session.expiresAt, sessionWarningAt: res.session.warningAt, error: null });
        } catch (e) {
          get().clearSession();
          throw e;
        }
      },
      requestPasswordReset: async (email) => {
        set({ loading: true, error: null, devCode: null });
        try {
          const res = await authApi.requestPasswordReset(email);
          set({ devCode: res.devCode ?? null });
          return res.devCode ?? null;
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      confirmPasswordReset: async (input) => {
        set({ loading: true, error: null });
        try {
          await authApi.confirmPasswordReset(input);
          get().clearSession();
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      loadPlans: async () => {
        try {
          const res = await authApi.plans();
          set({ plans: res.plans });
        } catch {
          // Keep the built-in UI usable when the server is offline.
        }
      },
      buyPlan: async (planId) => {
        const token = get().token;
        if (!token) throw new Error('Log in before buying Premium.');
        set({ loading: true, error: null });
        try {
          const res = await authApi.checkout(token, planId);
          set({ user: res.user });
          return res;
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      confirmCheckout: async (sessionId) => {
        const token = get().token;
        if (!token) throw new Error('Log in before confirming Premium.');
        set({ loading: true, error: null });
        try {
          const res = await authApi.confirmCheckout(token, sessionId);
          set({ user: res.user });
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      restorePurchases: async () => {
        const token = get().token;
        if (!token) throw new Error('Log in to restore purchases.');
        set({ loading: true, error: null });
        try {
          const res = await authApi.restore(token);
          set({ user: res.user });
          return res.restored;
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      manageSubscription: async () => {
        const token = get().token;
        if (!token) throw new Error('Log in to manage your subscription.');
        set({ loading: true, error: null });
        try {
          const res = await authApi.manage(token);
          set({ user: res.user });
          return res.message;
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      changePassword: async (input) => {
        const token = get().token;
        if (!token) throw new Error('Log in to change your password.');
        set({ loading: true, error: null });
        try {
          const res = await authApi.changePassword(token, input);
          set({ user: res.user });
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      deleteAccount: async () => {
        const token = get().token;
        if (!token) throw new Error('Log in to delete your account.');
        set({ loading: true, error: null });
        try {
          await authApi.deleteAccount(token);
          get().clearSession();
        } catch (e) {
          const message = errorMessage(e);
          set({ error: message });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
    }),
    {
      name: 'filemint-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ user, token, sessionExpiresAt, sessionWarningAt, plans, devCode }) => ({
        user,
        token,
        sessionExpiresAt,
        sessionWarningAt,
        plans,
        devCode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

export function selectIsPremium(state: AuthState): boolean {
  return isPremiumUser(state.user);
}

export function selectIsLoggedIn(state: AuthState): boolean {
  return !!state.token && !!state.user && !sessionExpired(state.sessionExpiresAt);
}
