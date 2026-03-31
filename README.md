# daishinkawa-skillsheet

スキルシート用のドキュメントサイトです。`docs/` を正本として管理し、`apps/docs` の Nextra サイトへ同期して表示します。

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
