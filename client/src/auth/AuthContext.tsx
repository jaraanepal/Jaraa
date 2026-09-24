import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { authApi, meApi, onAuthExpired, setAccessToken } from "../api/client";
import type { Profile, Role } from "../api/types";

interface AuthState {
  isAuthed: boolean;
  role: Role | null;
  phone: string | null;
  profile: Profile | null;
  profileLoading: boolean;
  login: (phone: string, code: string, claimGuestScanId?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const Ctx = createContext<AuthState>({
  isAuthed: false,
  role: null,
  phone: null,
  profile: null,
  profileLoading: false,
  login: async () => {},
  logout: async () => {},
  refreshProfile: async () => null,
});

const PHONE_KEY = "jaraa:phone";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokenSet, setTokenSet] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [phone, setPhone] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PHONE_KEY);
    } catch {
      return null;
    }
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (): Promise<Profile | null> => {
    setProfileLoading(true);
    try {
      const p = await meApi.getProfile();
      setProfile(p);
      // NOTE: the v1 contract's Profile schema doesn't carry `role` — the
      // role claim rides on the JWT, set by login(). Do NOT default to
      // "customer" here or we would clobber the JWT-verified role.
      const carried = (p as unknown as { role?: Role } | null)?.role;
      if (carried && (["customer", "doctor", "admin", "pharmacy", "coach"] as Role[]).includes(carried)) {
        setRole(carried);
      }
      return p;
    } catch {
      setProfile(null);
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // NOTE: the v1 contract's Profile schema doesn't carry `role`; the role
  // claim rides on the JWT. We decode the payload (no verification — the
  // server is the authority; this only drives UI routing).
  const roleFromToken = (jwt: string): Role => {
    try {
      const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const r = String(payload.role ?? "customer");
      return (["customer", "doctor", "admin", "pharmacy", "coach"] as Role[]).includes(r as Role)
        ? (r as Role)
        : "customer";
    } catch {
      return "customer";
    }
  };

  const login = useCallback(
    async (ph: string, code: string, claimGuestScanId?: string) => {
      const res = await authApi.verifyOtp(ph, code, claimGuestScanId);
      setAccessToken(res.access_token);
      setTokenSet(true);
      setPhone(res.user.phone);
      setRole(res.user.role ?? roleFromToken(res.access_token));
      try {
        localStorage.setItem(PHONE_KEY, res.user.phone);
      } catch {
        /* ignore */
      }
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setTokenSet(false);
      setRole(null);
      setProfile(null);
      setPhone(null);
      try {
        localStorage.removeItem(PHONE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => onAuthExpired(() => logout()), [logout]);

  const value: AuthState = {
    isAuthed: tokenSet,
    role,
    phone,
    profile,
    profileLoading,
    login,
    logout,
    refreshProfile: loadProfile,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  return useContext(Ctx);
}
