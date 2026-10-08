const fs = require("fs");

const {
  TIKTOK_AUTH_URL,
  TIKTOK_TOKEN_URL,
  TIKTOK_USER_INFO_URL,
  TIKTOK_PUBLISH_INIT_URL,
  TIKTOK_PUBLISH_STATUS_URL,
  TIKTOK_CREATOR_INFO_URL,
  TIKTOK_REVOKE_URL,
} = require("./socialSharingConfig");

const REQUEST_TIMEOUT_MS = 10000;
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024; // TikTok's single-chunk ceiling

class TikTokProviderError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "TikTokProviderError";
    this.status = status;
  }
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_ID,
    scope: "user.info.basic,video.publish",
    response_type: "code",
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    state,
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new TikTokProviderError(`TikTok token exchange failed: ${body.error_description || body.error}`, {
      status: response.status,
    });
  }
  // { access_token, refresh_token, expires_in, open_id, scope }
  return body;
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new TikTokProviderError(`TikTok token refresh failed: ${body.error_description || body.error}`, {
      status: response.status,
    });
  }
  return body;
}

// Revokes Bes's authorization on the user's TikTok account (used when the
// Bes account is deleted). TikTok answers success with an empty body.
async function revokeAccessToken(accessToken) {
  const response = await fetch(TIKTOK_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      token: accessToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new TikTokProviderError(`TikTok revoke failed: ${details}`, { status: response.status });
  }
}

async function fetchProfile(accessToken) {
  const response = await fetch(`${TIKTOK_USER_INFO_URL}?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json();
  if (!response.ok || body.error?.code !== "ok") {
    throw new TikTokProviderError(`TikTok profile lookup failed: ${body.error?.message}`, {
      status: response.status,
    });
  }
  return { providerUserId: body.data.user.open_id, username: body.data.user.display_name };
}

// What this creator is allowed to post as right now. While the TikTok app
// is unaudited, TikTok itself only returns ["SELF_ONLY"] here — so the
// Publishing screen's privacy options come from TikTok, not from us, and
// upgrade on their own once the audit passes. Throws on failure; callers
// treat any failure as ["SELF_ONLY"].
async function fetchCreatorInfo(accessToken) {
  const response = await fetch(TIKTOK_CREATOR_INFO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json();
  if (!response.ok || body.error?.code !== "ok") {
    throw new TikTokProviderError(`TikTok creator_info lookup failed: ${body.error?.message}`, {
      status: response.status,
    });
  }
  return {
    privacyLevelOptions: body.data?.privacy_level_options ?? [],
    maxVideoPostDurationSec: body.data?.max_video_post_duration_sec ?? null,
  };
}

// Direct Post via FILE_UPLOAD — bytes are streamed to TikTok's own
// upload_url, never requiring a public URL for our storage. Capped at a
// single chunk (MAX_SINGLE_CHUNK_BYTES); a longer/larger segment is a
// known Phase C gap (real multi-chunk upload), not silently truncated —
// this throws instead.
async function publishVideoFile({ accessToken, filePath, title, privacyLevel = "SELF_ONLY" }) {
  const { size } = fs.statSync(filePath);
  if (size > MAX_SINGLE_CHUNK_BYTES) {
    throw new TikTokProviderError(
      `Video is ${Math.round(size / 1024 / 1024)}MB, over the ${MAX_SINGLE_CHUNK_BYTES / 1024 / 1024}MB single-chunk limit this integration supports today.`,
    );
  }

  const initResponse = await fetch(TIKTOK_PUBLISH_INIT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      post_info: {
        title: title || "Shared from Bes",
        privacy_level: privacyLevel, // validated against creator_info by the controller; SELF_ONLY by default
        disable_duet: true,
        disable_comment: false,
        disable_stitch: true,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const initBody = await initResponse.json();
  if (!initResponse.ok || initBody.error?.code !== "ok") {
    throw new TikTokProviderError(`TikTok publish init failed: ${initBody.error?.message}`, {
      status: initResponse.status,
    });
  }

  const { publish_id: publishId, upload_url: uploadUrl } = initBody.data;

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${size - 1}/${size}`,
    },
    body: fs.readFileSync(filePath),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 3),
  });

  if (!uploadResponse.ok) {
    const details = await uploadResponse.text();
    throw new TikTokProviderError(`TikTok video upload failed: ${details}`, { status: uploadResponse.status });
  }

  return { publishId };
}

// Bounded poll — TikTok's own publish pipeline can take longer than this
// handler should block a request for, so this returns whatever status it
// last observed rather than waiting for PUBLISH_COMPLETE indefinitely.
async function pollPublishStatus(accessToken, publishId, { attempts = 3, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await fetch(TIKTOK_PUBLISH_STATUS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publish_id: publishId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json();
    const status = body?.data?.status;
    if (status === "PUBLISH_COMPLETE" || status === "FAILED") return status;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return "PROCESSING";
}

module.exports = {
  TikTokProviderError,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchProfile,
  fetchCreatorInfo,
  revokeAccessToken,
  publishVideoFile,
  pollPublishStatus,
};
