# DPRO CAR02 V4.99 — 既存予約との接続整理（隔離・本番未接続）

基準日: 2026-10-23 / ブランチ: car02-v434-review-only / GitHub HEAD 読取時: 7fffbcce0611caabcbacef8fe09a669e2746e7bd

## 結論

現行の WANGAN/KSH 系には予約機能が存在するため、新しい予約サーバーを追加しない。
V4.98A 共通画面の「架空文字列 ID」を本番の予約・顧客・車両 UUID と混同しないことが接続の要点。
V4.99 はその読取専用変換だけを提供する。実予約データに接続済みとは扱わない。

## 読み取った既存ソース

| ソース | 既存の役割 | API |
| --- | --- | --- |
| index.html | KSH のお客様向け LINE 問合せ／希望入庫日時 | POST `/ksh/api/inquiries` |
| dashboard.html | WANGAN の店舗予約管理 | GET/POST `/wangan/api/reservations`, PATCH/DELETE `/wangan/api/reservations/{id}` |
| owner-ipad.html | KSH の店頭登録・入庫予約 | POST `/ksh/api/reservations` |
| car02-api.mjs | CAR02 案件作成候補。認証と releaseEnabled の注入が必須 | POST `/api/car02` |
| car02-legacy-reservation-handoff-readonly-isolated.mjs | R13 予約 UUID から CAR02 作成要求の確認（送信不可） | read-only / sendable=false |

API 前半 `/wangan` または `/ksh` は既存共通アダプター配下の区分であり、ブラウザ表示ラベルから任意に設定してはいけない。

**重要:** お客様側の `POST /api/inquiries` は問い合わせ受付であり、確定予約ではない。予約への昇格は、既存の店舗管理処理と空き枠検証を通す。

## 今回の最小成果物

- `car02-existing-reservation-map-v499-isolated.mjs`: 既存予約行をオーナー画面向けに正規化する、通信も書込みもしない関数。
- `car02-existing-reservation-map-v499-isolated.test.mjs`: 4件 PASS。UUID、テナント、30分枠、問い合わせと予約の区別。
- 本番 Worker / Supabase / LINE / GitHub main / 既存データ: 未変更。

## 最小の接続残作業（順序）

1. **信頼できる取得口**：店舗別の既存予約一覧を認証済みサーバーから取得し、行の `shop_code` を独立に検証する。既存の GET の認証を無効化しない。
2. **ID 紐付け**：実予約 UUID・顧客 UUID・車両 UUID を CAR02 案件作成へ渡す。CAR02 案件 UUID と実予約 UUID を別物として管理する。
3. **更新経路の確認**：既存の PATCH/DELETE を使う場合、サーバー側で再度権限・空き枠・変更競合・削除済み状態を確認する。ブラウザの選択だけで確定させない。
4. **隔離環境で1件確認**：架空テナント・架空予約で、一覧→予約→一覧の同一 ID を確認した後に公開判断。余分なテスト追加はしない。

## 運用ロック

- releaseLock=true / NO_GO / DB HOLD を維持。
- V4.98A オーナー一覧→予約画面→一覧の人的画面確認 PASS を維持。
- V4.97 GitHub Actions 合格の事実を維持。V4.99 の GitHub Actions 合格とは主張しない。
- Google・LINE・Square・本番 DB 接続を済みと表示しない。
