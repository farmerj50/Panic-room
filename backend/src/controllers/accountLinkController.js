// relationshipType (child | family | friend) is descriptive only — it
// controls display (avatar tint, label) and NOTHING else. No handler in
// this file may branch permission-granting or visibility logic on it; the
// `permissions` JSON on each row is the sole source of truth for what's
// actually shared, regardless of how a link is tagged. This is worth
// re-reading before adding anything that reads relationshipType, since
// "it's tagged 'child', so let's also expose X" is exactly the mistake
// this comment exists to prevent.

const prisma = require("../config/db");
const { decrypt } = require("../services/cryptoService");
const { isUserPremium, MAX_LINKED_ACCOUNTS_PRO } = require("../services/subscriptionService");
const { issueInvite, findPendingLinkByCode, acceptInvite: acceptInviteCode } = require("../services/accountLinkService");

const RELATIONSHIP_TYPES = ["child", "family", "friend"];
const DEFAULT_PERMISSIONS = { emergencyAlerts: true, liveLocationDuringEmergency: true, backgroundLocation: false };

function displayName(user) {
  return user?.nameEncrypted ? decrypt(user.nameEncrypted) : "";
}

function permissionsOf(link) {
  return { ...DEFAULT_PERMISSIONS, ...(link.permissions || {}) };
}

function serializeOwnedLink(link) {
  return {
    id: link.id,
    createdAt: link.createdAt,
    relationshipType: link.relationshipType,
    status: link.status,
    permissions: permissionsOf(link),
    linkedUserName: link.status === "active" ? displayName(link.linkedUser) : null,
    expiresAt: link.status === "pending" ? link.expiresAt : null,
    acceptedAt: link.acceptedAt,
  };
}

function serializeLinkToMe(link) {
  return {
    id: link.id,
    createdAt: link.createdAt,
    relationshipType: link.relationshipType,
    permissions: permissionsOf(link),
    ownerName: displayName(link.ownerUser),
    acceptedAt: link.acceptedAt,
  };
}

const REASONS = {
  invalid_code: "That code isn't valid. Double-check it and try again.",
  expired: "This invite code has expired.",
  too_many_attempts: "Too many attempts on this code. Ask for a new invite.",
  owner_at_cap: "This person has already reached their Bes Pro linked-account limit.",
  cannot_link_self: "You can't link your own account.",
};

exports.createInvite = async (req, res, next) => {
  try {
    const relationshipType = String(req.body.relationshipType || "").trim();
    if (!RELATIONSHIP_TYPES.includes(relationshipType)) {
      return res.status(400).json({ error: "relationshipType must be one of: child, family, friend" });
    }

    const [existingCount, user] = await Promise.all([
      prisma.accountLink.count({
        where: { ownerUserId: req.user.id, status: { in: ["pending", "active"] } },
      }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { subscriptionExpiresAt: true } }),
    ]);

    // requirePremium (route middleware) already blocks free users from
    // reaching this handler at all — this is the separate numeric cap,
    // which needs a count, not a boolean gate. Re-checking isUserPremium
    // here too rather than trusting the middleware ran is cheap and keeps
    // this function correct in isolation.
    if (!isUserPremium(user)) {
      return res.status(403).json({ error: "Bes Premium is required for this feature.", code: "PREMIUM_REQUIRED" });
    }
    if (existingCount >= MAX_LINKED_ACCOUNTS_PRO) {
      return res.status(403).json({
        error: `You've reached your Bes Pro linked-account limit of ${MAX_LINKED_ACCOUNTS_PRO}. Remove an existing linked account before adding another.`,
        code: "LINKED_ACCOUNT_LIMIT_REACHED",
      });
    }

    const { link, code } = await issueInvite(req.user.id, relationshipType);

    res.status(201).json({
      id: link.id,
      relationshipType: link.relationshipType,
      status: link.status,
      code,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

exports.previewInvite = async (req, res, next) => {
  try {
    const result = await findPendingLinkByCode(req.body.code);
    if (!result.ok) {
      return res.status(400).json({ error: REASONS[result.reason] || "Invalid code.", code: result.reason });
    }

    const { link } = result;
    const permissions = permissionsOf(link);

    // Narrow, purpose-built DTO — not the raw permissions JSON — so the
    // consent-screen contract is intentional and never accidentally
    // exposes a future internal permission key just because it exists in
    // storage. backgroundLocationEligible (not "granted") reflects that
    // accepting the invite alone never turns this on — the linked user
    // still has to separately opt in afterward.
    res.json({
      linkId: link.id,
      ownerName: displayName(link.ownerUser),
      relationshipType: link.relationshipType,
      sharesEmergencyAlerts: Boolean(permissions.emergencyAlerts),
      sharesLiveLocationDuringEmergency: Boolean(permissions.liveLocationDuringEmergency),
      backgroundLocationEligible: Boolean(permissions.backgroundLocation),
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

exports.acceptInvite = async (req, res, next) => {
  try {
    const result = await acceptInviteCode(req.user.id, req.body.code);
    if (!result.ok) {
      return res.status(400).json({ error: REASONS[result.reason] || "Invalid code.", code: result.reason });
    }

    res.json(serializeLinkToMe({
      ...result.link,
      ownerUser: await prisma.user.findUnique({ where: { id: result.link.ownerUserId }, select: { nameEncrypted: true } }),
    }));
  } catch (error) {
    next(error);
  }
};

exports.getOwnedLinks = async (req, res, next) => {
  try {
    const links = await prisma.accountLink.findMany({
      where: { ownerUserId: req.user.id, status: { in: ["pending", "active"] } },
      include: { linkedUser: { select: { nameEncrypted: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(links.map(serializeOwnedLink));
  } catch (error) {
    next(error);
  }
};

exports.getLinksToMe = async (req, res, next) => {
  try {
    const links = await prisma.accountLink.findMany({
      where: { linkedUserId: req.user.id, status: "active" },
      include: { ownerUser: { select: { nameEncrypted: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(links.map(serializeLinkToMe));
  } catch (error) {
    next(error);
  }
};

exports.updatePermissions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.accountLink.findFirst({
      where: { id, ownerUserId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Linked account not found" });

    // backgroundLocation can only be granted by the linked user themselves
    // (their own separate Background Location Monitoring opt-in has to
    // exist first) — the owner can never turn it on, only see it.
    if (req.body.backgroundLocation === true) {
      return res.status(400).json({
        error: "Only the linked person can enable background location sharing from their own account.",
        code: "BACKGROUND_LOCATION_NOT_OWNER_SETTABLE",
      });
    }

    const next_ = { ...permissionsOf(existing) };
    if (req.body.emergencyAlerts !== undefined) next_.emergencyAlerts = Boolean(req.body.emergencyAlerts);
    if (req.body.liveLocationDuringEmergency !== undefined) {
      next_.liveLocationDuringEmergency = Boolean(req.body.liveLocationDuringEmergency);
    }

    const updated = await prisma.accountLink.update({
      where: { id },
      data: { permissions: next_ },
      include: { linkedUser: { select: { nameEncrypted: true } } },
    });

    res.json(serializeOwnedLink(updated));
  } catch (error) {
    next(error);
  }
};

exports.revokeLink = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Who may revoke depends on status: a 'pending' row has no
    // linkedUserId yet, so there's no "linked" party to grant revoke
    // rights to — only the owner can revoke an outstanding invite.
    const link = await prisma.accountLink.findFirst({
      where: {
        id,
        OR: [
          { ownerUserId: req.user.id },
          { linkedUserId: req.user.id, status: "active" },
        ],
      },
    });
    if (!link) return res.status(404).json({ error: "Linked account not found" });

    const revokedByRole = link.ownerUserId === req.user.id ? "owner" : "linked";

    await prisma.accountLink.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date(), revokedByRole },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
