import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SITE_PASSWORD_COOKIE_NAME = "site_password_session";
export const INVALID_PASSWORD_ERROR_CODE = "invalid-password";

const SESSION_VERSION = "v1";
const ENABLED_FLAG_VALUE = "true";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * 共有パスワード保護を有効にするかどうかを判定する。
 * Vercel の Production 環境だけで変数を入れる運用を想定し、フラグが true の時だけ閉じる。
 */
export function isSitePasswordGateEnabled() {
  return process.env.SITE_PASSWORD_ENABLED === ENABLED_FLAG_VALUE;
}

/**
 * パスワード保護に必要な秘密情報が揃っているかを確認する。
 * 有効化済みなのに設定が欠けている場合は、サイトを公開せず 503 を返す判断材料に使う。
 */
export function getSitePasswordConfigurationError() {
  if (!isSitePasswordGateEnabled()) {
    return null;
  }

  if (!process.env.SITE_PASSWORD) {
    return "SITE_PASSWORD_ENABLED=true ですが、SITE_PASSWORD が未設定です。";
  }

  if (!process.env.SITE_PASSWORD_SECRET) {
    return "SITE_PASSWORD_ENABLED=true ですが、SITE_PASSWORD_SECRET が未設定です。";
  }

  return null;
}

/**
 * 外部サイトへのオープンリダイレクトを防ぎつつ、元の閲覧先だけを保持する。
 * `/unlock` や `/api/unlock` 自身へ戻す値はループの原因になるため `/` に丸める。
 */
export function normalizeSafeRedirectTarget(target) {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return "/";
  }

  if (target === "/unlock" || target.startsWith("/unlock?")) {
    return "/";
  }

  if (target === "/api/unlock" || target.startsWith("/api/unlock?")) {
    return "/";
  }

  return target;
}

/**
 * ロック画面への遷移先 URL を統一して組み立てる。
 * エラー種別と元の閲覧先を同じ形式で渡し、Proxy と API で分岐を増やさないようにする。
 */
export function createUnlockLocation(target = "/", errorCode) {
  const searchParams = new URLSearchParams({
    next: normalizeSafeRedirectTarget(target)
  });

  if (errorCode) {
    searchParams.set("error", errorCode);
  }

  return `/unlock?${searchParams.toString()}`;
}

/**
 * パスワード変更時に既存セッションを自動失効させるため、現在のパスワードから固定長ダイジェストを作る。
 * Cookie に平文パスワードを載せずに署名対象だけを安定化する目的で使う。
 */
function createPasswordDigest(password) {
  return createHash("sha256").update(password).digest("base64url");
}

/**
 * Cookie 値を秘密鍵付き HMAC で署名し、改ざん検知と設定ローテーションの両方を成立させる。
 * シークレット変更時も値が変わるため、サーバー側に状態を持たずに失効できる。
 */
function createSessionSignature(password, secret) {
  return createHmac("sha256", secret)
    .update(`${SESSION_VERSION}:${createPasswordDigest(password)}`)
    .digest("base64url");
}

/**
 * 署名比較を一定時間化し、Cookie や入力値の照合で長さや一致位置の差が漏れにくいようにする。
 * 長さが違う場合は即座に失敗扱いにしつつ、同長比較時だけ `timingSafeEqual` を使う。
 */
function safeCompareStringValues(left, right) {
  const leftBuffer = Buffer.from(left ?? "", "utf8");
  const rightBuffer = Buffer.from(right ?? "", "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * 現在の設定から期待されるセッション Cookie 値を組み立てる。
 * 値は設定由来で毎回再計算できるため、サーバー側セッションストアを追加せずに済む。
 */
export function createSitePasswordSessionValue() {
  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    throw new Error(configurationError);
  }

  return `${SESSION_VERSION}.${createSessionSignature(
    process.env.SITE_PASSWORD,
    process.env.SITE_PASSWORD_SECRET
  )}`;
}

/**
 * 受け取った Cookie が現在の設定で発行されたものかを検証する。
 * パスワードかシークレットのどちらかが変われば失効する設計にしている。
 */
export function isValidSitePasswordSessionValue(sessionValue) {
  if (typeof sessionValue !== "string" || !sessionValue.startsWith(`${SESSION_VERSION}.`)) {
    return false;
  }

  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    return false;
  }

  return safeCompareStringValues(sessionValue, createSitePasswordSessionValue());
}

/**
 * 入力された共有パスワードを一定時間比較で検証する。
 * 成功条件をこの関数へ閉じ込め、API 側では Cookie 発行フローだけに集中できるようにする。
 */
export function isSubmittedPasswordValid(submittedPassword) {
  if (typeof submittedPassword !== "string" || submittedPassword.length === 0) {
    return false;
  }

  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    return false;
  }

  return safeCompareStringValues(submittedPassword, process.env.SITE_PASSWORD);
}

/**
 * Set-Cookie ヘッダー文字列を自前で組み立てる。
 * 依存追加を避けつつ、HttpOnly・SameSite・Secure を統一したいので最小限のシリアライザを持つ。
 */
function serializeCookie(name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge) {
    attributes.push(`Max-Age=${options.maxAge}`);
  }

  if (options.path) {
    attributes.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    attributes.push("HttpOnly");
  }

  if (options.sameSite) {
    attributes.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

/**
 * 本番では Secure 属性付き、ローカル検証では HTTP でも確認可能な Cookie ヘッダーを返す。
 * Vercel 本番の HTTPS 配信を前提にしつつ、手元の `next start` でも検証しやすくする。
 */
export function createSitePasswordSessionCookieHeader(requestProtocol) {
  return serializeCookie(SITE_PASSWORD_COOKIE_NAME, createSitePasswordSessionValue(), {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: requestProtocol === "https"
  });
}
