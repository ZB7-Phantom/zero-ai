import { PlanTier } from '@prisma/client';

// ⚠️ PLACEHOLDER PRICES — set your real monthly plan prices here (in whole
// Naira). These drive MRR and the billing breakdown in the admin console.
// STARTER is treated as free. When real Paystack billing lands, these can be
// replaced by prices pulled from Paystack plans.
export const PLAN_PRICES: Record<PlanTier, number> = {
  STARTER: 0,
  NAVIGATOR: 25000,
  ENTERPRISE: 75000,
};

export const PLAN_ORDER: PlanTier[] = ['STARTER', 'NAVIGATOR', 'ENTERPRISE'];
