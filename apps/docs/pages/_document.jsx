import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  // Chrome に日本語ページであることと翻訳対象外であることを伝え、
  // 自動翻訳ツールバーが出てしまうのを抑える。
  return (
    <Html lang="ja" translate="no" className="notranslate">
      <Head>
        <meta httpEquiv="Content-Language" content="ja" />
        <meta name="google" content="notranslate" />
      </Head>
      <body className="notranslate">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
