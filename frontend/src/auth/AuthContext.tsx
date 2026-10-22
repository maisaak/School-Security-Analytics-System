import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, setAccessToken, UNAUTHORIZED_EVENT, User } from "../api/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  demoLogin: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Баннер «сессия истекла» показываем только тем, у кого сессия реально была:
  // иначе любой фоновый 401 на холодном старте пугает пользователя.
  const hadSession = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
      hadSession.current = true;
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      if (hadSession.current) {
        setError("Сессия истекла — войдите заново");
      }
      hadSession.current = false;
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const session = await api.login(username, password);
      setAccessToken(session.access_token ?? null);
      setUser(session.user);
      hadSession.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось войти";
      setError(message);
      throw err;
    }
  }, []);

  const demoLogin = useCallback(async (username: string) => {
    setError(null);
    try {
      const session = await api.demoLogin(username);
      setAccessToken(session.access_token ?? null);
      setUser(session.user);
      hadSession.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось выполнить быстрый вход";
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setError(null);
      hadSession.current = false;
    }
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, login, demoLogin, logout, can }),
    [user, loading, error, login, demoLogin, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
