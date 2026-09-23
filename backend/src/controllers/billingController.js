const prisma = require("../config/db");
const { isUserPremium, FREE_CONTACT_LIMIT, MAX_LINKED_ACCOUNTS_PRO } = require("../services/subscriptionService");

// Event types that grant/extend entitlement.
const ENTITLING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "TRANSFER",
]);

// Event types that don't change *whether* the user is entitled right now
// (they're still entitled until subscriptionExpiresAt), just why/how.
const STATUS_ONLY_EVENTS = { CANCELLATION: "cancelled", BILLING_ISSUE: "billing_issue" };

// Event types that end entitlement outright.
const REVOKING_EVENTS = new Set(["EXPIRATION"]);

exports.handleWebhook = async (req, res, next) => {
  try {
    const event = req.body?.event;
    if (!event?.app_user_id || !event?.type) {
      // Malformed payload or a RevenueCat connectivity test ping — ack so
      // it doesn't get retried forever, there's nothing actionable here.
      return res.status(200).json({ received: true });
    }

    const data = {};
    if (ENTITLING_EVENTS.has(event.type)) {
      data.subscriptionStatus = "active";
      data.subscriptionExpiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
      data.subscriptionProductId = event.product_id ?? null;
    } else if (event.type in STATUS_ONLY_EVENTS) {
      data.subscriptionStatus = STATUS_ONLY_EVENTS[event.type];
      // Still entitled until expiry — keep/refresh the timestamp, don't null it.
      if (event.expiration_at_ms) data.subscriptionExpiresAt = new Date(event.expiration_at_ms);
    } else if (REVOKING_EVENTS.has(event.type)) {
      data.subscriptionStatus = "expired";
      data.subscriptionExpiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : new Date(0);
    } else {
      // e.g. SUBSCRIPTION_PAUSED, TEST — nothing for us to apply.
      return res.status(200).json({ received: true });
    }

    // Ordering guard: RevenueCat doesn't strictly guarantee webhook delivery
    // order. A stale, late-arriving event must never regress a user's
    // entitlement, so only apply this event if it's newer than the last one
    // we actually processed for this user.
    const eventTimestamp = event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date();
    const user = await prisma.user.findUnique({
      where: { id: event.app_user_id },
      select: { lastRevenueCatEventAt: true },
    });

    if (!user) {
      console.warn(`RevenueCat webhook: no user found for app_user_id=${event.app_user_id}`);
      return res.status(200).json({ received: true });
    }

    if (user.lastRevenueCatEventAt && user.lastRevenueCatEventAt.getTime() > eventTimestamp.getTime()) {
      console.warn(
        `RevenueCat webhook: dropping stale event ${event.type} for app_user_id=${event.app_user_id} ` +
          `(event ${eventTimestamp.toISOString()} older than last-processed ${user.lastRevenueCatEventAt.toISOString()})`,
      );
      return res.status(200).json({ received: true });
    }

    data.lastRevenueCatEventAt = eventTimestamp;

    await prisma.user.update({ where: { id: event.app_user_id }, data });

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
};

exports.getStatus = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionStatus: true, subscriptionExpiresAt: true },
    });

    const premium = isUserPremium(user);
    res.json({
      isPremium: premium,
      subscriptionStatus: user?.subscriptionStatus ?? "free",
      subscriptionExpiresAt: user?.subscriptionExpiresAt ?? null,
      contactLimit: premium ? null : FREE_CONTACT_LIMIT,
      // Never unlimited (unlike contactLimit's null-for-Pro convention) —
      // free users get 0, Pro users get the fixed cap.
      linkedAccountLimit: premium ? MAX_LINKED_ACCOUNTS_PRO : 0,
    });
  } catch (error) {
    next(error);
  }
};
