# daishinkawa-skillsheet

スキルシート用のドキュメントサイトです。`docs/` を正本として管理し、`apps/docs` の Nextra サイトへ同期して表示します。

## パスワード保護の有効化方法

本番サイトの共有パスワード保護は、Vercel の環境変数で切り替えます。

1. Vercel の対象プロジェクトを開く
2. `Settings` → `Environment Variables` を開く
3. `Production` 環境にだけ次の 3 つを設定する

```bash
SITE_PASSWORD_ENABLED=true
SITE_PASSWORD=<共有パスワード>
SITE_PASSWORD_SECRET=<長いランダム文字列>
```

4. 環境変数を保存する
5. Production を再デプロイする

### 運用メモ

- `SITE_PASSWORD_ENABLED` が `true` の時だけ保護が有効になります
- `SITE_PASSWORD_ENABLED` を未設定にすると、Preview とローカルは従来通り公開のまま動きます
- `SITE_PASSWORD` を変更すると、既存の認証 Cookie は自動で無効化されます
- `SITE_PASSWORD_SECRET` は十分に長いランダム文字列を使ってください
- `SITE_PASSWORD_ENABLED=true` なのに `SITE_PASSWORD` または `SITE_PASSWORD_SECRET` が欠けている場合、本番では 503 を返して保護漏れを防ぎます

### ローカルで保護状態を確認する例

```bash
pnpm docs:build
SITE_PASSWORD_ENABLED=true SITE_PASSWORD='example-password' SITE_PASSWORD_SECRET='local-test-secret' pnpm --filter @daishinkawa-skillsheet/docs exec next start -p 3040
```

## 主要な pnpm コマンド

### 開発

```bash
pnpm dev
pnpm docs:dev
```

- `pnpm dev`: ドキュメントサイトの開発サーバーを起動します
- `pnpm docs:dev`: `pnpm dev` と同じく、`apps/docs` の開発サーバーを起動します

### 同期

```bash
pnpm docs:sync
```

- `docs/` の内容を `apps/docs/pages` に同期します

### ビルド

```bash
pnpm docs:build
```

- Nextra サイトを本番ビルドします

### 本番起動確認

```bash
pnpm docs:start
```

- ビルド済みサイトをローカルで起動します

### PDF 生成

```bash
pnpm genpdf
```

- スキルシートの PDF 生成スクリプトを実行します
