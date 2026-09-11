import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import {
  addCustomerInfoListener,
  getCurrentOffering,
  isPremiumFromCustomerInfo,
  purchasePackage as purchasePackageService,
  restorePurchases as restorePurchasesService,
} from '../services/purchasesService';
import { getBillingStatus } from '../services/billingService';

interface SubscriptionContextType {
  isPremium: boolean;
  loading: boolean;
  offering: PurchasesOffering | null;
  // Backend-authoritative free-tier contact cap; null = unlimited. Never
  // hardcoded client-side — see billingService.getBillingStatus.
  contactLimit: number | null;
  purchasePackage: (pkg: PurchasesPackage) => Promise<void>;
  restorePurchases: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [contactLimit, setContactLimit] = useState<number | null>(3);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const status = await getBillingStatus();
      if (!mounted.current) return;
      setIsPremium(status.isPremium);
      setContactLimit(status.contactLimit);
    } catch {
      // Network hiccup — keep whatever we last knew rather than clearing it;
      // the RevenueCat SDK listener below is the fast/authoritative path for
      // isPremium anyway, this is just a periodic backend cross-check.
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const current = await getCurrentOffering();
        if (active) setOffering(current);
      } catch {
        // Offerings unavailable (e.g. RevenueCat not configured in this
        // build) — paywall will just show no package to purchase.
      }
      await refresh();
      if (active) setLoading(false);
    })();

    const unsubscribe = addCustomerInfoListener((info: CustomerInfo) => {
      if (!active) return;
      setIsPremium(isPremiumFromCustomerInfo(info));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh]);

  const purchasePackage = useCallback(
    async (pkg: PurchasesPackage) => {
      const info = await purchasePackageService(pkg);
      setIsPremium(isPremiumFromCustomerInfo(info));
      await refresh();
    },
    [refresh],
  );

  const restorePurchases = useCallback(async () => {
    const info = await restorePurchasesService();
    setIsPremium(isPremiumFromCustomerInfo(info));
    await refresh();
  }, [refresh]);

  return (
    <SubscriptionContext.Provider
      value={{ isPremium, loading, offering, contactLimit, purchasePackage, restorePurchases, refresh }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return ctx;
}
