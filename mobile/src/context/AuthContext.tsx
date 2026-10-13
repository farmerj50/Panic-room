import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { ApiError, clearAuthToken, getAuthToken, setSessionExpiredHandler, setTokens } from '../services/apiClient';
import { getGA4ClientId } from '../services/nativeAnalytics';
import {
  AuthUser,
  deleteAccountRequest,
  googleSignInRequest,
  linkGoogleRequest,
  logoutRequest,
  loginRequest,
  meRequest,
  registerRequest,
  unlinkGoogleRequest,
  type DeletionProof,
} from '../services/authService';
import { getGoogleIdToken, GoogleSignInCancelled, signOutGoogle } from '../services/googleAuth';
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
  deleteAccount: (proof: DeletionProof) => Promise<void>;
  // Resolves 'signed_in', or 'cancelled' (user backed out — not an error).
  // Throws GoogleLinkRequiredError when the email already has a Bes account,
  // or an Error with a user-facing message for anything else.
  signInWithGoogle: () => Promise<'signed_in' | 'cancelled'>;
  linkGoogle: (password: string) => Promise<'linked' | 'cancelled'>;
  unlinkGoogle: () => Promise<void>;
};

export class GoogleLinkRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleLinkRequiredError';
  }
}

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
        trackEvent('login', { method: 'email' });
        loginPurchases(response.user.id).catch(() => {});
      },
      async register(name, email, password, beforeAuthenticate) {
        const ga4ClientId = Platform.OS === 'web' ? undefined : await getGA4ClientId();
        const response = await registerRequest({ name, email, password, ga4ClientId });
        await setTokens(response.accessToken, response.refreshToken);
        await beforeAuthenticate?.();
        const variant = await getOnboardingVariant();
        setOnboardingVariant(variant);
        trackEvent('sign_up', { variant, method: 'email' });
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
      async signInWithGoogle() {
        trackEvent('google_sign_in_started');
        let idToken: string;
        try {
          idToken = await getGoogleIdToken();
        } catch (error) {
          if (error instanceof GoogleSignInCancelled) {
            trackEvent('google_sign_in_cancelled');
            return 'cancelled';
          }
          trackEvent('google_sign_in_failed', { reason: 'google_error' });
          await signOutGoogle();
          throw new Error('Google sign-in failed on this device. Try again, or continue with email.');
        }

        let response;
        try {
          const ga4ClientId = Platform.OS === 'web' ? undefined : await getGA4ClientId();
          response = await googleSignInRequest({ idToken, ga4ClientId });
        } catch (error) {
          const code = error instanceof ApiError ? error.code : undefined;
          trackEvent('google_sign_in_failed', { reason: code ?? (error instanceof ApiError ? `http_${error.status}` : 'network') });
          await signOutGoogle();
          if (code === 'account_exists_link_required') {
            throw new GoogleLinkRequiredError(error instanceof Error ? error.message : 'Sign in with your password first.');
          }
          if (error instanceof ApiError && error.status < 500 && error.message) throw new Error(error.message);
          throw new Error("Couldn't finish Google sign-in. Check your connection and try again.");
        }

        await setTokens(response.accessToken, response.refreshToken);
        if (response.isNewUser) {
          // Same post-registration path as email sign-up.
          const variant = await getOnboardingVariant();
          setOnboardingVariant(variant);
          trackEvent('sign_up', { variant, method: 'google' });
          setPostAuthTab('Home');
          setNeedsOnboarding(variant === 'onboarding');
        } else {
          trackEvent('login', { method: 'google' });
          setPostAuthTab(null);
        }
        setShouldOfferTour(!response.user.tourOffered);
        setUser(response.user);
        setStatus('authenticated');
        loginPurchases(response.user.id).catch(() => {});
        return 'signed_in';
      },
      async linkGoogle(password) {
        let idToken: string;
        try {
          idToken = await getGoogleIdToken();
        } catch (error) {
          if (error instanceof GoogleSignInCancelled) return 'cancelled';
          throw new Error('Google sign-in failed on this device. Try again.');
        }
        try {
          const response = await linkGoogleRequest({ idToken, password });
          setUser(response.user);
          trackEvent('google_linked');
          return 'linked';
        } finally {
          await signOutGoogle();
        }
      },
      async unlinkGoogle() {
        const response = await unlinkGoogleRequest();
        setUser(response.user);
        await signOutGoogle();
      },
      async logout() {
        await signOutGoogle();
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
      async deleteAccount(proof) {
        // Unlike logout(), this must throw on failure (e.g. wrong password)
        // — local state should only clear once the account is actually gone.
        await deleteAccountRequest(proof);
        await signOutGoogle();
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
