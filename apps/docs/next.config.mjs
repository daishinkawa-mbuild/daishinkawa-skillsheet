import nextra from "nextra";

const withNextra = nextra({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.jsx"
});

export default withNextra({
  // Nextra v2 を Next.js 16 上で安定して動かすため、webpack 起動を前提にする。
  turbopack: {},
  reactStrictMode: true
});
