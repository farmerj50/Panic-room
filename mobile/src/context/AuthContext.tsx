import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { clearAuthToken, getAuthToken, setSessionExpiredHandler, setTokens } from '../services/apiClient';
import {
  AuthUser,
  deleteAccountRequest,
  logoutRequest,
  loginRequest,
  meRequest,
  registerRequest,
} from '../services/authService';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
type PostAuthTab = 'Home';

type AuthContextType = {
  status: AuthStatus;
  user: AuthUser | null;
  postAuthTab: PostAuthTab | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    beforeAuthenticate?: () => Promise<void>,
  ) => Promise<void>;
  consumePostAuthTab: () => void;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [postAuthTab, setPostAuthTab] = useState<PostAuthTab | null>(null);

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
        setStatus('authenticated');
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
      setStatus('unauthenticated');
    });

    return () => setSessionExpiredHandler(null);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      status,
      user,
      postAuthTab,
      async login(email, password) {
        const response = await loginRequest({ email, password });
        await setTokens(response.accessToken, response.refreshToken);
        setPostAuthTab(null);
        setUser(response.user);
        setStatus('authenticated');
      },
      async register(name, email, password, beforeAuthenticate) {
        const response = await registerRequest({ name, email, password });
        await setTokens(response.accessToken, response.refreshToken);
        await beforeAuthenticate?.();
        setPostAuthTab('Home');
        setUser(response.user);
        setStatus('authenticated');
      },
      consumePostAuthTab() {
        setPostAuthTab(null);
      },
      async logout() {
        await logoutRequest();
        await clearAuthToken();
        setUser(null);
        setPostAuthTab(null);
        setStatus('unauthenticated');
      },
      async deleteAccount(password) {
        // Unlike logout(), this must throw on failure (e.g. wrong password)
        // — local state should only clear once the account is actually gone.
        await deleteAccountRequest(password);
        await clearAuthToken();
        setUser(null);
        setPostAuthTab(null);
        setStatus('unauthenticated');
      },
    }),
    [postAuthTab, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
