import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { clearAuthToken, getAuthToken, setSessionExpiredHandler, setTokens } from '../services/apiClient';
import { getGA4ClientId } from '../services/nativeAnalytics';
import {
  AuthUser,
  deleteAccountRequest,
  logoutRequest,
  loginRequest,
  meRequest,
  registerRequest,
} from '../services/authService';
import { loginPurchases, logoutPurchases } from '../services/purchasesService';
import { getOnboardingVariant, OnboardingVariant } from '../services/experiments';
import { trackEvent } from '../services/analyticsService';
import { resetSessionFlags } from '../services/sessionFlags';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
type PostAuthTab = 'Home';

type AuthContextType = {
  status: AuthStatus;
  user: AuthUser | null;
  postAuthTab: PostAuthTab | null;
  needsOnboarding: boolean;
  onboardingVariant: OnboardingVariant | null;
  shouldOfferTour: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    beforeAuthenticate?: () => Promise<void>,
  ) => Promise<void>;
  consumePostAuthTab: () => void;
  consumeOnboarding: () => void;
  consumeShouldOfferTour: () => boolean;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [postAuthTab, setPostAuthTab] = useState<PostAuthTab | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingVariant, setOnboardingVariant] = useState<OnboardingVariant | null>(null);
  const [shouldOfferTour, setShouldOfferTour] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const token = await getAuthToken();
        if (!token) {
          if (mounted) setStatus('unauthenticated');
          return;
        }

        const response = await meRequest();
        if (!mounted) return;

        setUser(response.user);
        setShouldOfferTour(!response.user.tourOffered);
        setStatus('authenticated');
        // Best-effort: a RevenueCat hiccup must never block session restore.
        loginPurchases(response.user.id).catch(() => {});
      } catch {
        await clearAuthToken();
        if (mounted) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    }

    restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    // Fires when apiClient exhausts a refresh attempt on a background 401
    // (e.g. the refresh token was revoked or expired) so the UI drops back
    // to the sign-in screen even without an explicit logout action.
    setSessionExpiredHandler(() => {
      setUser(null);
      setPostAuthTab(null);
      setNeedsOnboarding(false);
      setOnboardingVariant(null);
      setShouldOfferTour(false);
      resetSessionFlags();
      setStatus('unauthenticated');
    });

    return () => setSessionExpiredHandler(null);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      status,
      user,
      postAuthTab,
      needsOnboarding,
      onboardingVariant,
      shouldOfferTour,
      async login(email, password) {
        const response = await loginRequest({ email, password });
        await setTokens(response.accessToken, response.refreshToken);
        setPostAuthTab(null);
        setUser(response.user);
        setShouldOfferTour(!response.user.tourOffered);
        setStatus('authenticated');
        loginPurchases(response.user.id).catch(() => {});
      },
      async register(name, email, password, beforeAuthenticate) {
        const ga4ClientId = Platform.OS === 'web' ? undefined : await getGA4ClientId();
        const response = await registerRequest({ name, email, password, ga4ClientId });
        await setTokens(response.accessToken, response.refreshToken);
        await beforeAuthenticate?.();
        const variant = await getOnboardingVariant();
        setOnboardingVariant(variant);
        trackEvent('sign_up', { variant });
        setPostAuthTab('Home');
        setNeedsOnboarding(variant === 'onboarding');
        setShouldOfferTour(!response.user.tourOffered);
        setUser(response.user);
        setStatus('authenticated');
        loginPurchases(response.user.id).catch(() => {});
      },
      consumePostAuthTab() {
        setPostAuthTab(null);
      },
      consumeOnboarding() {
        setNeedsOnboarding(false);
      },
      consumeShouldOfferTour() {
        setShouldOfferTour(false);
        return shouldOfferTour;
      },
      async logout() {
        await logoutRequest();
        await clearAuthToken();
        setUser(null);
        setPostAuthTab(null);
        setNeedsOnboarding(false);
        setOnboardingVariant(null);
        setShouldOfferTour(false);
        resetSessionFlags();
        setStatus('unauthenticated');
        logoutPurchases().catch(() => {});
      },
      async deleteAccount(password) {
        // Unlike logout(), this must throw on failure (e.g. wrong password)
        // — local state should only clear once the account is actually gone.
        await deleteAccountRequest(password);
        await clearAuthToken();
        setUser(null);
        setPostAuthTab(null);
        setNeedsOnboarding(false);
        setOnboardingVariant(null);
        setShouldOfferTour(false);
        resetSessionFlags();
        setStatus('unauthenticated');
        logoutPurchases().catch(() => {});
      },
    }),
    [needsOnboarding, onboardingVariant, postAuthTab, shouldOfferTour, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
