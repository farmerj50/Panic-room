// Emergency Social Sharing. Each provider is a safe no-op — initiateConnect
// 503s — until this app has real developer-app credentials for it. These
// helpers are the single source of truth for "is this provider live,"
// matching the hasResendConfig()/hasSmsProviderConfig() shape used
// elsewhere in this service layer.
//
// Instagram goes through Meta's "Facebook Login for Business" product, so
// its credentials are the Meta app's own (META_APP_ID/META_APP_SECRET),
// not a separate Instagram-specific client id/secret, plus a Configuration
// ID (META_LOGIN_CONFIG_ID) created in Meta's dashboard that the five
// requested permissions (instagram_basic, instagram_content_publish,
// pages_read_engagement, business_management, pages_show_list) are bound
// to — editing those permissions means editing that Configuration in
// Meta's dashboard, not this code.

function hasTikTokConfig() {
  return Boolean(
    process.env.TIKTOK_CLIENT_ID && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI,
  );
}

function hasInstagramConfig() {
  return Boolean(
    process.env.META_APP_ID &&
      process.env.META_APP_SECRET &&
      process.env.META_LOGIN_CONFIG_ID &&
      process.env.INSTAGRAM_REDIRECT_URI,
  );
}

function availableProviders() {
  return { tiktok: hasTikTokConfig(), instagram: hasInstagramConfig() };
}

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_PUBLISH_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";
const TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

const META_GRAPH_VERSION = "v21.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_OAUTH_DIALOG_URL = "https://www.facebook.com/v21.0/dialog/oauth";

module.exports = {
  hasTikTokConfig,
  hasInstagramConfig,
  availableProviders,
  TIKTOK_AUTH_URL,
  TIKTOK_TOKEN_URL,
  TIKTOK_USER_INFO_URL,
  TIKTOK_PUBLISH_INIT_URL,
  TIKTOK_PUBLISH_STATUS_URL,
  TIKTOK_CREATOR_INFO_URL,
  META_GRAPH_BASE,
  META_OAUTH_DIALOG_URL,
};
