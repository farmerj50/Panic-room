import Purchases, { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { PREMIUM_ENTITLEMENT_ID, REVENUECAT_ANDROID_API_KEY } from '../config/purchasesConfig';

// Thin wrapper isolating the RevenueCat SDK surface from the rest of the app.

export function configurePurchases() {
  if (!REVENUECAT_ANDROID_API_KEY) return;
  Purchases.configure({ apiKey: REVENUECAT_ANDROID_API_KEY });
}

export async function loginPurchases(userId: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(userId);
  return customerInfo;
}

export async function logoutPurchases(): Promise<void> {
  await Purchases.logOut();
}

export function isPremiumFromCustomerInfo(info: CustomerInfo | null): boolean {
  return typeof info?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined';
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export function addCustomerInfoListener(listener: (info: CustomerInfo) => void): () => void {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}
