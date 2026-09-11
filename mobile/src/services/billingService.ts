import { apiRequest } from './apiClient';

export type BillingStatus = {
  isPremium: boolean;
  subscriptionStatus: string;
  subscriptionExpiresAt: string | null;
  // null = unlimited (premium); a number = the free-tier cap. Backend-
  // authoritative — the mobile app never hardcodes this value.
  contactLimit: number | null;
};

export function getBillingStatus() {
  return apiRequest<BillingStatus>('/api/billing/status');
}
