import Head from "next/head";

const INVALID_PASSWORD_ERROR_CODE = "invalid-password";

/**
 * クエリ由来のエラーコードを画面表示用メッセージへ変換する。
 * 具体的な認証失敗理由は増やしすぎず、利用者が再入力しやすい最小限の文言に留める。
 */
function getErrorMessage(errorCode) {
  if (errorCode === INVALID_PASSWORD_ERROR_CODE) {
    return "パスワードが正しくありません。";
  }

  return "";
}

/**
 * `query` や `req.body` から来る値を単一文字列へ正規化する。
 * Next.js では配列化されることがあるため、画面描画前に扱いやすい形へ揃える。
 */
function readSingleValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value : "";
}

/**
 * クライアント bundle にサーバー専用モジュールを混ぜないよう、このページ側でも戻り先を正規化する。
 * `/unlock` へ戻る値や外部 URL は許可せず、ログイン成功後の遷移先だけを保持する。
 */
function normalizeSafeRedirectTarget(target) {
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
 * 共有パスワードを入力する専用ページを描画する。
 * 保護対象ページの UI とは独立させ、誤設定時も同じ URL で状況説明を返せるようにする。
 */
export default function UnlockPage({
  errorCode,
  isMisconfigured,
  misconfigurationMessage,
  nextTarget
}) {
  const errorMessage = getErrorMessage(errorCode);

  return (
    <>
      <Head>
        <title>閲覧パスワード | Daishinkawa Skillsheet Docs</title>
      </Head>
      <main className="unlock-page">
        <section className="unlock-card">
          <p className="unlock-eyebrow">Protected Site</p>
          <h1>閲覧パスワードを入力してください</h1>
          <p className="unlock-description">
            このサイトは共有パスワードで保護されています。閲覧を続けるには、案内されたパスワードを入力してください。
          </p>

          {isMisconfigured ? (
            <p className="unlock-error" role="alert">
              {misconfigurationMessage}
            </p>
          ) : (
            <form action="/api/unlock" className="unlock-form" method="post">
              <input name="next" type="hidden" value={nextTarget} />
              <label className="unlock-label" htmlFor="site-password">
                パスワード
              </label>
              <input
                autoComplete="current-password"
                autoFocus
                className="unlock-input"
                id="site-password"
                name="password"
                required
                type="password"
              />
              {errorMessage ? (
                <p className="unlock-error" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <button className="unlock-button" type="submit">
                閲覧する
              </button>
            </form>
          )}
        </section>
      </main>

      <style jsx>{`
        .unlock-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(circle at top, rgba(19, 117, 157, 0.16), transparent 42%),
            linear-gradient(180deg, #f6fbfd 0%, #edf4f7 100%);
        }

        .unlock-card {
          width: min(100%, 440px);
          padding: 32px;
          border: 1px solid rgba(19, 117, 157, 0.14);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
        }

        .unlock-eyebrow {
          margin: 0 0 8px;
          color: #13759d;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        h1 {
          margin: 0;
          color: #12212b;
          font-size: 1.85rem;
          line-height: 1.3;
        }

        .unlock-description {
          margin: 12px 0 0;
          color: #4b5d6b;
          line-height: 1.7;
        }

        .unlock-form {
          margin-top: 24px;
          display: grid;
          gap: 12px;
        }

        .unlock-label {
          color: #243744;
          font-size: 0.95rem;
          font-weight: 600;
        }

        .unlock-input {
          width: 100%;
          padding: 14px 16px;
          border: 1px solid rgba(18, 33, 43, 0.16);
          border-radius: 12px;
          background: #ffffff;
          color: #12212b;
          font-size: 1rem;
        }

        .unlock-input:focus {
          outline: 2px solid rgba(19, 117, 157, 0.25);
          outline-offset: 2px;
          border-color: rgba(19, 117, 157, 0.4);
        }

        .unlock-button {
          margin-top: 4px;
          padding: 14px 16px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #13759d 0%, #0f5d7d 100%);
          color: #ffffff;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
        }

        .unlock-button:hover {
          filter: brightness(1.03);
        }

        .unlock-error {
          margin: 0;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(198, 40, 40, 0.08);
          color: #b3261e;
          line-height: 1.6;
        }

        @media (max-width: 640px) {
          .unlock-card {
            padding: 24px;
            border-radius: 16px;
          }

          h1 {
            font-size: 1.6rem;
          }
        }
      `}</style>
    </>
  );
}

/**
 * ロック画面そのものの表示可否をサーバー側で判断する。
 * 認証済みなら元ページへ戻し、設定不足なら 503 を返して保護漏れを防ぐ。
 */
export async function getServerSideProps(context) {
  const {
    SITE_PASSWORD_COOKIE_NAME,
    getSitePasswordConfigurationError,
    isSitePasswordGateEnabled,
    isValidSitePasswordSessionValue
  } = await import("../lib/site-password-session.js");
  const nextTarget = normalizeSafeRedirectTarget(readSingleValue(context.query.next));

  if (!isSitePasswordGateEnabled()) {
    return {
      redirect: {
        destination: nextTarget,
        permanent: false
      }
    };
  }

  const configurationError = getSitePasswordConfigurationError();

  if (configurationError) {
    context.res.statusCode = 503;

    return {
      props: {
        errorCode: "",
        isMisconfigured: true,
        misconfigurationMessage: configurationError,
        nextTarget
      }
    };
  }

  const sessionValue = context.req.cookies?.[SITE_PASSWORD_COOKIE_NAME];

  if (isValidSitePasswordSessionValue(sessionValue)) {
    return {
      redirect: {
        destination: nextTarget,
        permanent: false
      }
    };
  }

  return {
    props: {
      errorCode: readSingleValue(context.query.error),
      isMisconfigured: false,
      misconfigurationMessage: "",
      nextTarget
    }
  };
}
