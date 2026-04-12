import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/api/client";

interface User {
  id: number;
  username: string;
  display_name: string | null;
  patients: { id: number; slug: string; display_name: string; role: string }[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const checkSetup = async () => {
    try {
      const res = await api.get("/setup/status");
      return res.data.needs_setup === true;
    } catch {
      return false;
    }
  };

  const refreshUser = async () => {
    try {
      const res = await api.get("/auth/me");
      setUser(res.data);
      setNeedsSetup(false);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      const setup = await checkSetup();
      if (setup) {
        setNeedsSetup(true);
        setLoading(false);
        return;
      }
      await refreshUser();
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    await api.post("/auth/login", { username, password });
    const res = await api.get("/auth/me");
    setUser(res.data);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsSetup, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
