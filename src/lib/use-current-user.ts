"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/auth/roles";

export interface CurrentUser {
  username: string | null;
  role: Role;
  displayName: string | null;
  email: string | null;
  authSource: "local" | "entra";
}

/** The signed-in user (null while loading). Machine/anonymous identities report as admin. */
export function useCurrentUser(): CurrentUser | null {
  const [me, setMe] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((b) => {
        if (active && b.success) setMe(b.data as CurrentUser);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return me;
}
