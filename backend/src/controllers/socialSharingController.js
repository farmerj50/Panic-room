// Emergency Social Sharing. This feature is strictly additive: nothing
// here is called from, or able to affect, the emergency activation
// pipeline. See mobile/src/context/EmergencyContext.tsx /
// EmergencyScreen.tsx for that pipeline, which this file never touches —
// `share` below only ever reads an already-created EmergencyEvent/video
// segment, it never creates or mutates one.

const prisma = require("../config/db");
const { encrypt, decrypt } = require("../services/cryptoService");
const { signState, verifyState } = require("../services/oauthStateService");
const storageService = require("../services/storageService");
const tiktokClient = require("../services/tiktokClient");
const instagramClient = require("../services/instagramClient");
const { availableProviders, hasTikTokConfig, hasInstagramConfig } = require("../services/socialSharingConfig");

const PROVIDERS = ["tiktok", "instagram"];

// How long before expiry a token gets proactively refreshed. TikTok's
// access tokens are short-lived (24h) so this is tight; Instagram's are
// long-lived (~60 days) so this is generous — both just need to be well
// inside the token's own lifetime.
const TIKTOK_REFRESH_SKEW_MS = 5 * 60 * 1000;
const INSTAGRAM_REFRESH_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

// Privacy. Each provider has its own safe default, used whenever the
// requested value is missing/unknown/not allowed — never a cross-provider
// default. TikTok: SELF_ONLY (the only level an unaudited app may use, and
// the most private). Instagram: PUBLIC (Reels publish via the Graph API
// has no private option — it's the only value this feature exposes).
const TIKTOK_DEFAULT_PRIVACY = "SELF_ONLY";
const INSTAGRAM_PRIVACY_LEVELS = ["PUBLIC"];

const DEFAULT_CAPTION = "Shared from Bes";
const MAX_CAPTION_LENGTH = 2200; // both TikTok's title and Instagram's caption cap at 2200 chars

function normalizeCaption(raw) {
  const caption = typeof raw === "string" ? raw.trim().slice(0, MAX_CAPTION_LENGTH) : "";
  return caption || DEFAULT_CAPTION;
}

// Never throws — any creator_info failure means "SELF_ONLY only".
async function tiktokPrivacyLevels(accessToken) {
  try {
    const info = await tiktokClient.fetchCreatorInfo(accessToken);
    const levels = Array.isArray(info?.privacyLevelOptions) ? info.privacyLevelOptions.filter(Boolean) : [];
    return levels.length > 0 ? levels : [TIKTOK_DEFAULT_PRIVACY];
  } catch (error) {
    console.warn("TikTok creator_info failed, defaulting to SELF_ONLY:", error?.message || error);
    return [TIKTOK_DEFAULT_PRIVACY];
  }
}

function resolveTikTokPrivacy(requested, allowed) {
  return typeof requested === "string" && allowed.includes(requested) ? requested : TIKTOK_DEFAULT_PRIVACY;
}

function resolveInstagramPrivacy(requested) {
  return INSTAGRAM_PRIVACY_LEVELS.includes(requested) ? requested : "PUBLIC";
}

function isConfigured(provider) {
  if (provider === "tiktok") return hasTikTokConfig();
  if (provider === "instagram") return hasInstagramConfig();
  return false;
}

function requireValidProvider(req, res) {
  const provider = String(req.params.provider || "").trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    res.status(400).json({ error: "provider must be one of: tiktok, instagram" });
    return null;
  }
  return provider;
}

function serializeConnection(connection) {
  return {
    provider: connection.provider,
    status: connection.status,
    providerUsername: connection.providerUsername,
    enabledForEmergency: connection.enabledForEmergency,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

// GET /api/social — this user's connections plus which providers are live.
exports.listConnections = async (req, res, next) => {
  try {
    const connections = await prisma.socialConnection.findMany({
      where: { userId: req.user.id },
    });

    res.json({
      connections: connections.map(serializeConnection),
      available: availableProviders(),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/social/:provider/connect — starts the OAuth flow. 503s with a
// stable error code if this provider still isn't configured (kept as a
// safety net, not just a historical artifact — if a provider ever loses
// its config, this is still the correct response). Otherwise returns a
// real authorization URL carrying a signed `state` that lets the
// unauthenticated callback below recover which user is connecting.
exports.initiateConnect = async (req, res, next) => {
  try {
    const provider = requireValidProvider(req, res);
    if (!provider) return;

    if (!isConfigured(provider)) {
      return res
        .status(503)
        .json({ error: "This isn't available yet.", code: "social_sharing_not_configured" });
    }

    const state = signState({ userId: req.user.id, provider });
    const authorizationUrl =
      provider === "tiktok" ? tiktokClient.buildAuthorizationUrl(state) : instagramClient.buildAuthorizationUrl(state);

    res.json({ authorizationUrl });
  } catch (error) {
    next(error);
  }
};

// GET /api/social/:provider/callback — PUBLIC. The provider redirects the
// user's browser here directly after consent, so there is no bearer token
// on this request; `state` is the only thing authenticating it. Always
// responds with a redirect back into the app (never JSON, never a throw)
// since the caller is an in-app browser the user is watching, not an API
// client — see socialSharingRoutes.js for why this must be registered
// before the authenticated block.
exports.handleCallback = async (req, res) => {
  const provider = String(req.params.provider || "").trim().toLowerCase();
  const redirectTo = (status, extra = {}) => {
    const params = new URLSearchParams({ status, provider, ...extra });
    res.redirect(`bes://social-callback?${params.toString()}`);
  };

  if (!PROVIDERS.includes(provider)) return redirectTo("error", { reason: "invalid_provider" });

  const { code, state, error: providerError } = req.query;
  if (providerError) return redirectTo("error", { reason: String(providerError) });
  if (!code || !state) return redirectTo("error", { reason: "missing_code" });

  const verified = verifyState(String(state), provider);
  if (!verified) return redirectTo("error", { reason: "invalid_state" });

  try {
    let saved;
    if (provider === "tiktok") {
      const token = await tiktokClient.exchangeCodeForToken(String(code));
      const profile = await tiktokClient.fetchProfile(token.access_token);
      saved = {
        providerUserId: profile.providerUserId,
        providerUsername: profile.username,
        accessTokenEncrypted: encrypt(token.access_token),
        refreshTokenEncrypted: encrypt(token.refresh_token),
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
      };
    } else {
      const shortLived = await instagramClient.exchangeCodeForToken(String(code));
      const longLived = await instagramClient.exchangeForLongLivedToken(shortLived.access_token);
      const { igUserId, pageAccessToken } = await instagramClient.resolveInstagramBusinessAccount(
        longLived.accessToken,
      );
      const profile = await instagramClient.fetchProfile(igUserId, pageAccessToken);
      saved = {
        providerUserId: profile.providerUserId,
        providerUsername: profile.username,
        accessTokenEncrypted: encrypt(pageAccessToken),
        refreshTokenEncrypted: null,
        expiresAt: longLived.expiresAt,
      };
    }

    await prisma.socialConnection.upsert({
      where: { userId_provider: { userId: verified.userId, provider } },
      create: { userId: verified.userId, provider, status: "connected", ...saved },
      update: { status: "connected", ...saved },
    });

    redirectTo("connected");
  } catch (error) {
    console.error(`Social connect failed for ${provider}:`, error?.message || error);
    redirectTo("error", { reason: "connect_failed" });
  }
};

// DELETE /api/social/:provider — revokes a connection. Fully functional
// today; doesn't depend on any external credential.
exports.disconnect = async (req, res, next) => {
  try {
    const provider = requireValidProvider(req, res);
    if (!provider) return;

    const existing = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId: req.user.id, provider } },
    });

    if (!existing) {
      return res.json({ provider, status: "revoked" });
    }

    const updated = await prisma.socialConnection.update({
      where: { userId_provider: { userId: req.user.id, provider } },
      data: {
        status: "revoked",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        expiresAt: null,
      },
    });

    res.json(serializeConnection(updated));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/social/:provider — toggles whether this provider is offered
// during the emergency-time Share action.
exports.updatePreference = async (req, res, next) => {
  try {
    const provider = requireValidProvider(req, res);
    if (!provider) return;

    const enabledForEmergency = Boolean(req.body.enabledForEmergency);

    const existing = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId: req.user.id, provider } },
    });
    if (!existing) {
      return res.status(404).json({ error: "No connection found for this provider." });
    }

    const updated = await prisma.socialConnection.update({
      where: { userId_provider: { userId: req.user.id, provider } },
      data: { enabledForEmergency },
    });

    res.json(serializeConnection(updated));
  } catch (error) {
    next(error);
  }
};

async function ensureFreshTikTokToken(connection) {
  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (expiresAt - Date.now() > TIKTOK_REFRESH_SKEW_MS) {
    return decrypt(connection.accessTokenEncrypted);
  }
  const refreshed = await tiktokClient.refreshAccessToken(decrypt(connection.refreshTokenEncrypted));
  await prisma.socialConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encrypt(refreshed.access_token),
      refreshTokenEncrypted: encrypt(refreshed.refresh_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}

async function ensureFreshInstagramToken(connection) {
  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (expiresAt - Date.now() > INSTAGRAM_REFRESH_SKEW_MS) {
    return decrypt(connection.accessTokenEncrypted);
  }
  const refreshed = await instagramClient.refreshAccessToken(decrypt(connection.accessTokenEncrypted));
  await prisma.socialConnection.update({
    where: { id: connection.id },
    data: { accessTokenEncrypted: encrypt(refreshed.accessToken), expiresAt: refreshed.expiresAt },
  });
  return refreshed.accessToken;
}

// GET /api/social/:provider/publish-options — what the Publishing screen
// may offer. TikTok's comes from TikTok itself (creator_info); Instagram's
// is fixed. Never fails because of a provider error — falls back to the
// provider's safe default instead.
exports.getPublishOptions = async (req, res, next) => {
  try {
    const provider = requireValidProvider(req, res);
    if (!provider) return;

    if (provider === "instagram") {
      return res.json({ provider, privacyLevels: INSTAGRAM_PRIVACY_LEVELS });
    }

    const connection = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId: req.user.id, provider } },
    });
    if (!connection || connection.status !== "connected") {
      return res.status(400).json({ error: "Not connected to this provider.", code: "not_connected" });
    }

    let privacyLevels = [TIKTOK_DEFAULT_PRIVACY];
    try {
      const accessToken = await ensureFreshTikTokToken(connection);
      privacyLevels = await tiktokPrivacyLevels(accessToken);
    } catch (error) {
      console.warn("TikTok publish-options token refresh failed:", error?.message || error);
    }
    return res.json({ provider, privacyLevels });
  } catch (error) {
    next(error);
  }
};

// POST /api/social/:provider/share — the emergency-time Share action.
// Authenticated (called via a normal fetch from the live Emergency
// screen, same as the Call/Contact/FaceTime buttons). Posts exactly the
// segment the user reviewed — identified by `sequence`, which is unique per
// emergency (@@unique([emergencyId, sequence])) — and only if that
// emergency belongs to this user. Never independently picks "the newest"
// segment: a newer upload landing between preview and publish must not
// change what gets posted. Always resolves with a body describing the outcome — never an
// unhandled throw for a provider-side posting failure — since the mobile
// caller treats this the same way it treats any other independent
// emergency-screen action: it can fail without affecting anything else.
exports.share = async (req, res, next) => {
  try {
    const provider = requireValidProvider(req, res);
    if (!provider) return;

    const emergencyId = String(req.body.emergencyId || "");
    if (!emergencyId) return res.status(400).json({ error: "emergencyId is required" });
    const { sequence } = req.body;
    if (!Number.isInteger(sequence) || sequence < 1) {
      return res
        .status(400)
        .json({ error: "sequence must identify the reviewed video segment.", code: "invalid_segment" });
    }

    const [connection, emergency] = await Promise.all([
      prisma.socialConnection.findUnique({ where: { userId_provider: { userId: req.user.id, provider } } }),
      prisma.emergencyEvent.findFirst({
        where: { id: emergencyId, userId: req.user.id },
        // Scoped through the ownership-checked emergency, so a sequence
        // can never reach another user's (or another emergency's) segment.
        include: { videoSegments: { where: { sequence }, take: 1 } },
      }),
    ]);

    if (!connection || connection.status !== "connected") {
      return res.status(400).json({ error: "Not connected to this provider.", code: "not_connected" });
    }
    if (!connection.enabledForEmergency) {
      return res
        .status(400)
        .json({ error: "Sharing is turned off for this provider.", code: "disabled_for_emergency" });
    }
    if (!emergency) {
      return res.status(404).json({ error: "Emergency not found." });
    }
    const segment = emergency.videoSegments[0];
    if (!segment) {
      // Not uploaded yet (the client retries once on this), or not a real
      // segment of this emergency. Either way, nothing else is substituted.
      return res.status(400).json({ error: "No video available to share yet.", code: "no_video" });
    }

    const key = decrypt(segment.fileUrl);
    const caption = normalizeCaption(req.body.caption);

    try {
      if (provider === "tiktok") {
        const accessToken = await ensureFreshTikTokToken(connection);
        const filePath = storageService.getFilePath(key);
        if (!filePath) return res.json({ provider, status: "failed", error: "Video file not found." });

        // Re-validated against TikTok's own answer at post time — the
        // client's privacyLevel is a request, never trusted as-is.
        const privacyLevel = resolveTikTokPrivacy(req.body.privacyLevel, await tiktokPrivacyLevels(accessToken));
        const { publishId } = await tiktokClient.publishVideoFile({ accessToken, filePath, title: caption, privacyLevel });
        const status = await tiktokClient.pollPublishStatus(accessToken, publishId);
        return res.json({ provider, status: status === "FAILED" ? "failed" : "posted", privacyLevel });
      }

      // Reels publish takes no privacy param; resolved so the response
      // reports what actually happened (always PUBLIC) whatever was asked.
      const privacyLevel = resolveInstagramPrivacy(req.body.privacyLevel);
      const accessToken = await ensureFreshInstagramToken(connection);
      const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const videoUrl = storageService.getSignedDownloadUrl(key, baseUrl);
      const result = await instagramClient.publishReelFromUrl({
        igUserId: connection.providerUserId,
        pageAccessToken: accessToken,
        videoUrl,
        caption,
      });
      return res.json({ provider, status: result.status === "posted" ? "posted" : "processing", privacyLevel });
    } catch (postError) {
      console.error(`Social share failed for ${provider}:`, postError?.message || postError);
      return res.json({ provider, status: "failed", error: "Could not post right now." });
    }
  } catch (error) {
    next(error);
  }
};

module.exports.PROVIDERS = PROVIDERS;
