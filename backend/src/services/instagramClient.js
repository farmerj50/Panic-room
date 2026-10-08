// Instagram, via Meta's Graph API. Credentials and auth are the Meta app's
// own (META_APP_ID/META_APP_SECRET + the Facebook Login for Business
// Configuration, META_LOGIN_CONFIG_ID) — see socialSharingConfig.js's
// comment for why there's no separate "Instagram client id/secret".
//
// What we actually store and use for every later API call is the Page
// Access Token for the Facebook Page linked to the user's Instagram
// Business/Creator account, not the raw user access token — that's what
// Graph API's IG publishing endpoints expect.

const { META_GRAPH_BASE, META_OAUTH_DIALOG_URL } = require("./socialSharingConfig");

const REQUEST_TIMEOUT_MS = 10000;
const LONG_LIVED_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days, matches Meta's long-lived token lifetime

class InstagramProviderError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "InstagramProviderError";
    this.status = status;
  }
}

async function graphFetch(path, { method = "GET", params = {}, body } = {}) {
  const url = new URL(`${META_GRAPH_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new InstagramProviderError(`Instagram API error: ${json.error?.message || response.statusText}`, {
      status: response.status,
    });
  }
  return json;
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    state,
    response_type: "code",
    config_id: process.env.META_LOGIN_CONFIG_ID,
  });
  return `${META_OAUTH_DIALOG_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = await graphFetch("/oauth/access_token", {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code,
    },
  });
  return body; // { access_token, token_type, expires_in }
}

// Meta's initial token is short-lived (~1-2h) — exchange it for a
// long-lived (~60 day) token before storing anything.
async function exchangeForLongLivedToken(shortLivedToken) {
  const body = await graphFetch("/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    },
  });
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + LONG_LIVED_TOKEN_TTL_MS) };
}

async function refreshAccessToken(currentLongLivedToken) {
  return exchangeForLongLivedToken(currentLongLivedToken);
}

// Walks /me/accounts (the Pages this user manages) to find the one with an
// Instagram Business/Creator account attached, then returns that Page's
// own access token (what every IG publishing call needs) plus the IG
// Business Account id. Throws a clear, user-actionable error if no Page
// has one linked — a real prerequisite on the user's own account, not
// something this app can fix.
async function resolveInstagramBusinessAccount(userAccessToken) {
  const pages = await graphFetch("/me/accounts", { params: { access_token: userAccessToken } });

  for (const page of pages.data || []) {
    const pageDetail = await graphFetch(`/${page.id}`, {
      params: { fields: "instagram_business_account", access_token: page.access_token },
    });
    if (pageDetail.instagram_business_account?.id) {
      return {
        igUserId: pageDetail.instagram_business_account.id,
        pageAccessToken: page.access_token,
      };
    }
  }

  throw new InstagramProviderError(
    "No Instagram Business or Creator account is linked to any Facebook Page you manage. " +
      "Link one in Instagram's app settings (Settings > Account type and tools), then try connecting again.",
  );
}

async function fetchProfile(igUserId, pageAccessToken) {
  const body = await graphFetch(`/${igUserId}`, { params: { fields: "username", access_token: pageAccessToken } });
  return { providerUserId: igUserId, username: body.username };
}

// Container → poll → publish. Meta recommends polling once a minute for up
// to five minutes; a synchronous request handler can't block that long, so
// this polls briefly and returns a 'processing' status if it isn't
// FINISHED yet rather than hanging the HTTP response — see the
// socialSharingController's `share` handler for how that's surfaced.
async function publishReelFromUrl({ igUserId, pageAccessToken, videoUrl, caption }) {
  const container = await graphFetch(`/${igUserId}/media`, {
    method: "POST",
    body: { media_type: "REELS", video_url: videoUrl, caption, access_token: pageAccessToken },
  });
  const creationId = container.id;

  const finished = await pollContainerStatus(creationId, pageAccessToken);
  if (!finished) {
    return { status: "processing", creationId };
  }

  const published = await graphFetch(`/${igUserId}/media_publish`, {
    method: "POST",
    body: { creation_id: creationId, access_token: pageAccessToken },
  });

  return { status: "posted", mediaId: published.id };
}

async function pollContainerStatus(creationId, pageAccessToken, { attempts = 5, delayMs = 3000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const body = await graphFetch(`/${creationId}`, {
      params: { fields: "status_code", access_token: pageAccessToken },
    });
    if (body.status_code === "FINISHED") return true;
    if (body.status_code === "ERROR") {
      throw new InstagramProviderError("Instagram failed to process the video.");
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

module.exports = {
  InstagramProviderError,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  refreshAccessToken,
  resolveInstagramBusinessAccount,
  fetchProfile,
  publishReelFromUrl,
};
