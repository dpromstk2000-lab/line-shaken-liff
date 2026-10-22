# DPRO CAR02 V4.81｜GitHub実ジョブ・必須ステップ照合

- 基準：V4.80 GitHub Actions run 39716324419 / 1,022件PASS。
- 照合対象：V4.70〜V4.79の実在するGitHub Actions計10実行のジョブIDと実行結果。
- 3つの必須ステップ：原本／リリースロック確認、Node回帰、各バージョンの安全ゲートまたは使い捨てDB検査。
- V4.70〜V4.76では実際の使い捨てPostgreSQL 17検査ステップ成功も確認する。
- チェック：実ジョブ1件、期待run/job/Commit/URL一致、全ステップsuccess、必須ステップ順序、失敗・省略を拒否。
- 取得方法：GitHub ActionsのGITHUB_TOKENに actions:read / contents:read のみ許可、GitHub API GETのみ。
- GitHub APIが取得不能ならfail closedし、推測で合格扱いにしない。
- **限界**：CI実行履歴やステップ成功は商用サービスの証明ではない。実Supabase・LINE・Worker・WORM・鍵管理・オーナー承認は未検証。
- 本番Worker、共有Supabase、LINE、GitHub mainへの変更は禁止。NO_GO/HOLD継続。
