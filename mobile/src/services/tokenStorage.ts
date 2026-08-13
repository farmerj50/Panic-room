import { deleteItemAsync, getItemAsync, setItemAsync } from './secureStorage';

const ACCESS_TOKEN_KEY = 'bes_access_token';
const REFRESH_TOKEN_KEY = 'bes_refresh_token';

export async function getAccessToken() {
  return getItemAsync(ACCESS_TOKEN_KEY);
}

export async function setAccessToken(token: string) {
  await setItemAsync(ACCESS_TOKEN_KEY, token);
}

export async function getRefreshToken() {
  return getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string) {
  await setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function setTokens(accessToken: string, refreshToken: string) {
  await Promise.all([setAccessToken(accessToken), setRefreshToken(refreshToken)]);
}

export async function clearTokens() {
  await Promise.all([deleteItemAsync(ACCESS_TOKEN_KEY), deleteItemAsync(REFRESH_TOKEN_KEY)]);
}
