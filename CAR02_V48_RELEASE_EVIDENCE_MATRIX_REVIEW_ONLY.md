# DPRO CAR02 V4.8｜6つの公開阻止条件・証拠台帳（レビュー専用）

**判定：NO_GO / HOLD。** この台帳やV4.8のCI PASSをもって本番公開を許可してはならない。
GitHubコミット・ワークフローが成功しても、実DB、実JWT、LINE通知、顧客データの実証にはならない。

| ID | コードから観測できる現状 | 解消に必要な独立した証拠 |
|---|---|---|
| R46_STAFF_ACCESS_AUTH_VERSION_COLUMN_MISSING | R46草案に`auth_version`列がない | **使い捨てのPostgreSQL 17**でR13/R46の導入・移行・既存データ・権限・同時更新を再現した検査ログ。共有Supabaseでは絶対に試さない |
| R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN | 現在のR43トランザクションは所属レコードを行ロックしていない | 取引開始からCOMMITまでの同一DBクライアント・SELECT FOR UPDATEおよび所属変更との競合を示す、使い捨てDBの同時実行検査 |
| R43_REPLAY_REAUTHORIZATION_NOT_PROVEN | R43既存レスポンス再送が再認可なしで返される | 権限失効・店舗跨ぎ・認証バージョン変更後の再送を拒否する実DB実験（HTTP公開不要） |
| STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN | R46所属照会に`auth_version`がない | サーバ側でDB照会を信頼済みセッションと結び、都度失効を検査する実装と統合QAログ |
| LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN | 隔離Ed25519模型以外のライブ署名付きCAR02認証と失効の裏付けがない | 発行者・鍵ローテーション・有効期限・監査可能な本人紐付けの独立検証、秘密鍵流出なし |
| R52_PRODUCTION_RELEASE_LOCK_ACTIVE | `CAR02_RELEASE_LOCK=true`により公開不可 | 上記の全証拠が独立承認されるまで**このロックを維持**し、承認時のみ別の明示工程で解除判断 |

## 追加で閉じていない事項（上記6件とは別）

- V4.7通知リース案は**SQLブロックコメント内のレビュー専用原案**。実行されていない。
- R13の通知キューに永続的なclaim token/leaseの実装はなく、同時送信・送信結果不明・手動照合の実動作は未証明。
- トランザクション中の外部通知は禁止。LINE、DB、Worker、Supabaseの本番への操作は行わない。

## V4.8 判定仕様

- ソース監査が期待する「危険な未解決箇所」を正しく検出した場合にのみ`CI PASS`となる。
- 監査対象ソースが不足・変更したら「問題解決」と推定しない。**CI FAIL + 手動再評価**とする。
- `approved=true`、`release=GO`等、呼び出し側から渡す任意の自己申告を公開許可に使わない。
- V4.8の分析関数には本番接続、SQL実行、公開解除の実装はない。
- 使い捨てPostgreSQL 17は現時点では確保・実行できていないので、そこでの検査結果を名乗らない。

### 安全な実務順序

1. GitHub mainの実ソースを読み取り専用で監査。
2. 隔離PostgreSQL 17に対する移行前提・競合・ロールバック・RLS検査を準備（**共有DBは禁止**）。
3. 署名付き認証とDB側失効照合を、実動作で独立検証。
4. 6項目の真正な証拠が揃ったあとに別途公開承認。V4.8自体はGOを出さない。

本番Worker・R43/R44/R52・共有Supabase・LINEはこのバージョンで変更しない。
