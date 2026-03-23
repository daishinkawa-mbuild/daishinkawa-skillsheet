import { NextResponse } from "next/server";

import {
  SITE_PASSWORD_COOKIE_NAME,
  createUnlockLocation,
  getSitePasswordConfigurationError,
  isSitePasswordGateEnabled,
  isValidSitePasswordSessionValue
} from "./lib/site-password-session";

/**
 * ロック画面の描画や送信自体は常に通し、認証導線が自分で塞がらないようにする。
 * `_next/data` 経由の `/unlock` 取得もここで除外し、クライアント遷移時のループを防ぐ。
 */
function isBypassedPath(pathname) {
  if (pathname === "/unlock" || pathname === "/api/unlock") {
    return true;
  }

  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return true;
  }

  return pathname.startsWith("/_next/data/") && pathname.endsWith("/unlock.json");
}

/**
 * 設定不足でロック画面すら成立しない時は、理由を明示した 503 を返す。
 * 誤設定のまま本番を開けないことを優先し、静的ページの通常描画へは進ませない。
 */
function createMisconfigurationResponse(message) {
  return new NextResponse(message, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8"
    },
    status: 503
  });
}

/**
 * 本番だけを共有パスワードで塞ぎ、認証済み Cookie がある時だけ通常描画へ通す。
 * それ以外の閲覧は `/unlock` へ寄せて、元の URL は `next` パラメータとして保持する。
 */
export function proxy(request) {
  if (!isSitePasswordGateEnabled()) {
    return NextResponse.next();
  }

  if (isBypassedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    return createMisconfigurationResponse(configurationError);
  }

  const sessionValue = request.cookies.get(SITE_PASSWORD_COOKIE_NAME)?.value;

  if (isValidSitePasswordSessionValue(sessionValue)) {
    return NextResponse.next();
  }

  const unlockLocation = createUnlockLocation(
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );

  return NextResponse.redirect(new URL(unlockLocation, request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"
  ]
};
