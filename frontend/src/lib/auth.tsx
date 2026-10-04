import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, use, useEffect, useMemo } from "react";

import { ApiError, api, onAuthProblem } from "./api";
import { disablePush, syncPushSubscription } from "./push";
import type { AppConfig, Me } from "./types";

interface AuthValue {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<Me>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<Me | null> {
  try {
    return (await api.get<{ user: Me }>("/api/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status > 0) && count < 3,
  });

  useEffect(
    () =>
      onAuthProblem((error) => {
        if (error.status === 401) queryClient.setQueryData(["me"], null);
        else void queryClient.invalidateQueries({ queryKey: ["me"] });
      }),
    [queryClient],
  );

  const signedInId = me.data && !me.data.mustChangePassword ? me.data.id : null;
  useEffect(() => {
    if (signedInId) void syncPushSubscription().catch(() => undefined);
  }, [signedInId]);

  const value = useMemo<AuthValue>(() => {
    // Drop the previous person's data, but keep the ["me"] query itself alive:
    // removing it would detach this provider's observer from the cache.
    const forgetUserData = () =>
      queryClient.removeQueries({
        predicate: (query) => !["me", "config"].includes(String(query.queryKey[0])),
      });
    return {
      user: me.data ?? null,
      loading: me.isPending,
      async login(username, password) {
        const { user } = await api.post<{ user: Me }>("/api/auth/login", { username, password });
        forgetUserData();
        queryClient.setQueryData(["me"], user);
        return user;
      },
      async logout() {
        await disablePush().catch(() => undefined);
        await api.post("/api/auth/logout").catch(() => undefined);
        forgetUserData();
        queryClient.setQueryData(["me"], null);
      },
      async changePassword(currentPassword, newPassword) {
        const { user } = await api.post<{ user: Me }>("/api/auth/change-password", {
          currentPassword,
          newPassword,
        });
        queryClient.setQueryData(["me"], user);
        return user;
      },
    };
  }, [me.data, me.isPending, queryClient]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<AppConfig>("/api/config"),
    staleTime: Infinity,
  });
}

export function homePath(role: Me["role"]): string {
  return role === "ADMIN" ? "/admin" : role === "DRIVER" ? "/driver" : "/parent";
}
