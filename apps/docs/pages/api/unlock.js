import {
  INVALID_PASSWORD_ERROR_CODE,
  createSitePasswordSessionCookieHeader,
  createUnlockLocation,
  getSitePasswordConfigurationError,
  isSitePasswordGateEnabled,
  isSubmittedPasswordValid,
  normalizeSafeRedirectTarget
} from "../../lib/site-password-session";

/**
 * Next.js の `req.body` から単一文字列だけを安全に取り出す。
 * 同名キーが複数届いた場合でも最初の値だけを使い、以降の認証処理を単純化する。
 */
function readSingleValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value : "";
}

/**
 * Vercel 本番では HTTPS、ローカル検証では HTTP をそのまま見分ける。
 * Cookie の Secure 属性を環境に応じて切り替え、手元テストと本番安全性を両立する。
 */
function getRequestProtocol(req) {
  const forwardedProtocol = req.headers["x-forwarded-proto"];

  if (typeof forwardedProtocol === "string" && forwardedProtocol.length > 0) {
    return forwardedProtocol.split(",")[0].trim();
  }

  return req.socket?.encrypted ? "https" : "http";
}

/**
 * 共有パスワード送信を受けて Cookie を発行し、元の閲覧先へ戻す。
 * 誤設定時は 503、誤ったパスワード時は `/unlock` へ戻すだけにして情報を増やさない。
 */
export default function unlockHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).send("Method Not Allowed");
    return;
  }

  const nextTarget = normalizeSafeRedirectTarget(readSingleValue(req.body?.next));

  if (!isSitePasswordGateEnabled()) {
    res.redirect(302, nextTarget);
    return;
  }

  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    res.status(503).send(configurationError);
    return;
  }

  const submittedPassword = readSingleValue(req.body?.password);

  if (!isSubmittedPasswordValid(submittedPassword)) {
    res.redirect(302, createUnlockLocation(nextTarget, INVALID_PASSWORD_ERROR_CODE));
    return;
  }

  res.setHeader("Set-Cookie", createSitePasswordSessionCookieHeader(getRequestProtocol(req)));
  res.redirect(302, nextTarget);
}
