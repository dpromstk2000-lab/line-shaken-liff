# DPRO CAR02 V5.00 — 既存予約のオーナー一覧接続（隔離版）

2026-10-23 / GitHub review: `car02-v434-review-only`

## 何を完了したか

1. V4.99 の予約行変換で、`reservation_time` 未設定の仮入庫を一覧から落とさず、`時間未定` として表示できるように修正。存在しない時刻を捏造せず、変更操作は無効のまま。
2. 既存 GET `/wangan/api/reservations` と `/ksh/api/reservations` が返す `{reservations: [...]}` を受ける純粋関数 `buildOwnerReservationList` を追加。
3. 一覧→予約詳細→一覧は同一の **実予約 UUID** を引き継ぐ。CAR02 案件 UUID は未紐付けで `null`、混同しない。
4. 店舗相違、重複予約 ID、不正な15分時刻は拒否。テスト 4+4 = 8/8 PASS（ローカル）。

## 接続元を実際に調べた結果

- GitHub `dashboard.html` / `owner-ipad.html`: 認証済みの `/api/reservations` 一覧と予約の PATCH/DELETE が既存。
- Supabase `dpro-car-service-control-adapter` V3: 契約前の本番オーナー管理アクセスは `PRODUCTION_OWNER_BINDING_REQUIRED` で意図的に **401**。店舗の本番オーナー認証を勝手につながない。
- お客様の `/api/inquiries` は問い合わせ。確定予約とは別物。
- 実 API の返却行に常に `shop_code` が含まれるかは未立証。接続時はサーバー認証で検証した店舗スコープと予約行の実対応を確認する。

## 配置

GitHub review ブランチの **リポジトリ直下** に4ファイル。

- `car02-existing-reservation-map-v499-isolated.mjs`（V5.00で同ファイルを更新）
- `car02-existing-owner-navigation-v500-isolated.mjs`（新規）
- `car02-existing-owner-navigation-v500-isolated.test.mjs`（新規）
- `CAR02_V500_OWNER_READONLY_BRIDGE.md`（新規）

**ZIPファイルそのものをGitHubへドロップしない。** 展開した4ファイルのみをアップロード。

## 公開までの残作業

- 契約後に店舗オーナー認証を本番で結合し、取得結果に認証済み店舗スコープを付与。
- 予約 ID・顧客 ID・車両 ID と CAR02 案件を正規のサーバー処理で紐付ける。
- 本番公開は別途明示承認が必要。V5.00は通信・書込みゼロ。

## 保持する合格とロック

- V4.97 GitHub Actions 1607/1607 PASS、ローカル 585/585 PASS（過去の合格）。
- V4.98A 共通画面「オーナー一覧→予約→一覧」人的操作 PASS。
- V4.99 GitHub 3ファイル照合一致、コミット `e5321cd6744fae3b547f92b9518bf57fa6ab1f62`。V4.99の新規 Actions 合格とは主張しない。
- V5.00はローカル8/8 PASS。GitHub Actionsの合格は未確認。
- 本番Worker・Supabase・LINE・GitHub main・既存データ未変更。`releaseLock=true` / `NO_GO` / DB `HOLD`。
