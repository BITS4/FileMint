import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { selectIsPremium, useAuth } from '@/store/useAuth';
import type { ToolDef } from '@/types';

export function premiumUpgradeRoute(tool: ToolDef, redirect = tool.route): string {
  return `/upgrade?lockedTool=${encodeURIComponent(tool.id)}&redirect=${encodeURIComponent(redirect)}`;
}

export function useOpenTool() {
  const router = useRouter();
  const isPremium = useAuth(selectIsPremium);

  return useCallback(
    (tool: ToolDef, redirect = tool.route) => {
      if (tool.premium && !isPremium) {
        router.push(premiumUpgradeRoute(tool, redirect) as never);
        return;
      }
      router.push(redirect as never);
    },
    [isPremium, router],
  );
}
