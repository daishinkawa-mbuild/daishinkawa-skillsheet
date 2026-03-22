import "nextra-theme-docs/style.css";
import "../styles/docs-overrides.css";

export default function App({ Component, pageProps }) {
  // Nextra の全ページに共通スタイルを適用するため、カスタム App で描画を包む。
  return <Component {...pageProps} />;
}
