(() => {
  "use strict";

  const auditStartedAt = { value: 0 };
  const auditTimings = new Map();

  const extraChecks = [
    {
      id: "frontIndex",
      kind: "front",
      title: "お客様フォーム公開確認",
      desc: "公開フォームが読み込め、管理用ヘッダーやReset秘密情報を含まないことを確認します。",
      url: `${FRONT_BASE}/index.html?v=step-ksh-next-9-audit`,
      expectedMarkers: ["/api/inquiries"],
      forbiddenMarkers: ["X-Dashboard-Token", "x-ksh-demo-reset-secret", "RESET_WORKER_BASE", "ksh_dashboard_token"],
      warnMs: 3000,
      warnBytes: 700000,
      hardBytes: 1400000
    },
    {
      id: "frontDashboard",
      kind: "front",
      title: "PC管理画面・追加機能確認",
      desc: "進捗、見積承認、次回フォローのJavaScriptが読み込まれる構成か確認します。",
      url: `${FRONT_BASE}/dashboard.html?v=step-ksh-next-9-audit`,
      expectedMarkers: [
        "STEP KSH-NEXT-8",
        "ksh-next-5-owner-estimate.js",
        "ksh-next-8-followup-cockpit.js"
      ],
      warnMs: 3500,
      warnBytes: 1100000,
      hardBytes: 1900000
    },
    {
      id: "frontIpad",
      kind: "front",
      title: "受付iPad画面確認",
      desc: "3列現場ボードとiPad最適化JavaScriptの公開状態を確認します。",
      url: `${FRONT_BASE}/owner-ipad.html?v=step-ksh-next-9-audit`,
      expectedMarkers: ["STEP KSH-NEXT-6", "ksh-next-6-ipad-operations.js"],
      warnMs: 3000,
      warnBytes: 850000,
      hardBytes: 1500000
    },
    {
      id: "frontMember",
      kind: "front",
      title: "マイカーページ・公開情報確認",
      desc: "見積承認と車両別履歴が読み込まれ、管理用情報が公開HTMLへ混入していないことを確認します。",
      url: `${FRONT_BASE}/member.html?v=step-ksh-next-9-audit&demo=1`,
      expectedMarkers: [
        "STEP KSH-NEXT-7",
        "ksh-next-5-member-estimate.js",
        "ksh-next-7-member-history.js"
      ],
      forbiddenMarkers: ["X-Dashboard-Token", "x-ksh-demo-reset-secret", "RESET_WORKER_BASE", "ksh_dashboard_token"],
      warnMs: 3000,
      warnBytes: 700000,
      hardBytes: 1300000
    },
    {
      id: "frontSystemCheck",
      kind: "front",
      title: "内部監査ページ公開確認",
      desc: "system-checkがNEXT-9版で、検索除外設定を持つことを確認します。",
      url: `${FRONT_BASE}/system-check.html?v=step-ksh-next-9-audit`,
      expectedMarkers: [
        "STEP KSH-NEXT-9",
        'name="robots" content="noindex,nofollow,noarchive"',
        "ksh-next-9-system-audit.js"
      ],
      warnMs: 3000,
      warnBytes: 650000,
      hardBytes: 1100000
    },
    {
      id: "ownerEstimateAsset",
      kind: "front",
      title: "見積承認JavaScript",
      desc: "オーナー側の見積承認処理ファイルを確認します。",
      url: `${FRONT_BASE}/ksh-next-5-owner-estimate.js?v=step-ksh-next-9-audit`,
      expectedMarkers: ["KSH_NEXT_5_ESTIMATE_OWNER", "publishEstimateForCustomer"],
      warnMs: 2500,
      warnBytes: 180000,
      hardBytes: 350000
    },
    {
      id: "ipadAsset",
      kind: "front",
      title: "iPad最適化JavaScript",
      desc: "iPadの進捗分類・見積承認ガード処理ファイルを確認します。",
      url: `${FRONT_BASE}/ksh-next-6-ipad-operations.js?v=step-ksh-next-9-audit`,
      expectedMarkers: ["KSH_NEXT_6_IPAD", "advanceIpadProgress"],
      warnMs: 2500,
      warnBytes: 200000,
      hardBytes: 380000
    },
    {
      id: "memberHistoryAsset",
      kind: "front",
      title: "会員整備履歴JavaScript",
      desc: "車両別の現在進捗・整備履歴処理ファイルを確認します。",
      url: `${FRONT_BASE}/ksh-next-7-member-history.js?v=step-ksh-next-9-audit`,
      expectedMarkers: ["KSH_NEXT_7_MEMBER_HISTORY", "renderMaintenanceHistory"],
      forbiddenMarkers: ["X-Dashboard-Token", "x-ksh-demo-reset-secret", "RESET_WORKER_BASE"],
      warnMs: 2500,
      warnBytes: 220000,
      hardBytes: 400000
    },
    {
      id: "followupAsset",
      kind: "front",
      title: "次回フォローJavaScript",
      desc: "期限分類・候補カード・対応履歴処理ファイルを確認します。",
      url: `${FRONT_BASE}/ksh-next-8-followup-cockpit.js?v=step-ksh-next-9-audit`,
      expectedMarkers: ["KSH_NEXT_8_FOLLOWUP", "candidateTiming"],
      warnMs: 2500,
      warnBytes: 220000,
      hardBytes: 400000
    },
    {
      id: "invalidAdminGuard",
      kind: "security",
      title: "無効な管理コード拒否",
      desc: "誤った管理コードで管理ダッシュボードAPIを取得できないことを確認します。",
      path: "/api/dashboard",
      expectedStatuses: [401, 403]
    }
  ];

  for (const item of extraChecks) {
    if (!checks.some(check => check.id === item.id)) {
      checks.push(item);
      state[item.id] = { status: "未確認", detail: "" };
    }
  }

  const originalSetCheck = setCheck;
  const originalSummarizeResult = summarizeResult;

  statusClass = function(status) {
    if (status === "OK") return "ok";
    if (status === "NG") return "ng";
    if (status === "注意") return "attention";
    if (status === "確認中") return "checking";
    return "warn";
  };

  setCheck = function(id, status, detail) {
    originalSetCheck(id, status, detail);
    renderAuditMetrics();
  };

  updateOverallFromState = function() {
    const values = Object.values(state).map(row => row.status);
    const okCount = values.filter(value => value === "OK").length;
    const warnCount = values.filter(value => value === "注意").length;
    const ngCount = values.filter(value => value === "NG").length;
    const checking = values.some(value => value === "確認中");

    if (checking) {
      showOverall(`確認中：OK ${okCount} / 注意 ${warnCount} / 全${values.length}件`, "checking");
    } else if (ngCount > 0) {
      showOverall(`要修正：NG ${ngCount}件 / 注意 ${warnCount}件 / OK ${okCount}件`, "ng");
    } else if (okCount + warnCount === values.length && warnCount > 0) {
      showOverall(`動作OK・注意 ${warnCount}件 / OK ${okCount}件`, "attention");
    } else if (okCount === values.length) {
      showOverall(`すべてOK ${okCount}/${values.length}`, "ok");
    } else {
      showOverall(`未確認：OK ${okCount} / 注意 ${warnCount} / 全${values.length}件`, "warn");
    }

    renderAuditMetrics();
  };

  function renderAuditMetrics() {
    const values = Object.values(state).map(row => row.status);
    setTextSafe("auditOkCount", values.filter(value => value === "OK").length);
    setTextSafe("auditWarnCount", values.filter(value => value === "注意").length);
    setTextSafe("auditNgCount", values.filter(value => value === "NG").length);

    if (auditStartedAt.value > 0) {
      const finished = !values.some(value => value === "確認中");
      const elapsed = performance.now() - auditStartedAt.value;
      setTextSafe("auditDuration", finished ? `${(elapsed / 1000).toFixed(1)}秒` : "実行中");
    }
  }

  function setTextSafe(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        ...options,
        cache: "no-store",
        signal: controller.signal
      });
      const body = await response.text();
      return {
        response,
        body,
        elapsedMs: Math.round(performance.now() - started)
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function parseJson(body) {
    try {
      return body ? JSON.parse(body) : null;
    } catch {
      return { raw: body };
    }
  }

  function frontDetail(item, result, status) {
    const bytes = new Blob([result.body]).size;
    return [
      `状態: ${status}`,
      `HTTP: ${result.response.status}`,
      `読込時間: ${result.elapsedMs}ms`,
      `転送後サイズ: ${(bytes / 1024).toFixed(1)}KB`,
      `URL: ${item.url}`
    ].join("\n");
  }

  runCheck = async function(id) {
    const item = checks.find(row => row.id === id);
    if (!item) return;

    setCheck(id, "確認中", "");

    try {
      if (item.kind === "front") {
        const result = await fetchWithTimeout(item.url, {
          headers: { Accept: "text/html,application/javascript,text/plain,*/*" }
        });

        if (!result.response.ok) {
          throw new Error(`HTTP ${result.response.status}`);
        }

        for (const marker of item.expectedMarkers || []) {
          if (!result.body.includes(marker)) {
            throw new Error(`必須マーカーがありません: ${marker}`);
          }
        }

        for (const marker of item.forbiddenMarkers || []) {
          if (result.body.includes(marker)) {
            throw new Error(`公開してはいけない管理用マーカーを検出: ${marker}`);
          }
        }

        const bytes = new Blob([result.body]).size;
        if (item.hardBytes && bytes > item.hardBytes) {
          throw new Error(`容量上限超過: ${(bytes / 1024).toFixed(1)}KB`);
        }

        const attention =
          (item.warnMs && result.elapsedMs > item.warnMs) ||
          (item.warnBytes && bytes > item.warnBytes);

        auditTimings.set(id, result.elapsedMs);
        setCheck(
          id,
          attention ? "注意" : "OK",
          frontDetail(item, result, attention ? "速度・容量を確認" : "正常")
        );
        return;
      }

      if (item.kind === "security") {
        const result = await fetchWithTimeout(`${WORKER_API_BASE}${item.path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Dashboard-Token": "__invalid_ksh_next_9__"
          }
        });

        if (!(item.expectedStatuses || []).includes(result.response.status)) {
          throw new Error(`無効コードが拒否されませんでした: HTTP ${result.response.status}`);
        }

        auditTimings.set(id, result.elapsedMs);
        setCheck(
          id,
          "OK",
          [
            `無効管理コードを拒否: HTTP ${result.response.status}`,
            `応答時間: ${result.elapsedMs}ms`,
            "管理APIの認証ガードは有効です。"
          ].join("\n")
        );
        return;
      }

      const path = typeof item.path === "function" ? item.path() : item.path;
      const base = item.reset ? RESET_WORKER_BASE : WORKER_API_BASE;
      const headers = { Accept: "application/json" };
      if (item.auth) headers["X-Dashboard-Token"] = getToken();

      const result = await fetchWithTimeout(`${base}${path}`, {
        method: "GET",
        headers
      });
      const data = parseJson(result.body);

      if (!result.response.ok || !item.expect(data)) {
        const message =
          data && (data.message || data.error)
            ? data.message || data.error
            : `HTTP ${result.response.status}`;
        throw new Error(message);
      }

      auditTimings.set(id, result.elapsedMs);
      const summary = originalSummarizeResult(id, data);
      const attention = result.elapsedMs > 3000;
      setCheck(
        id,
        attention ? "注意" : "OK",
        [
          summary || pretty(data),
          `応答時間: ${result.elapsedMs}ms`
        ].filter(Boolean).join("\n")
      );

      if (id === "publicShopSettings" || id === "adminShopSettings") {
        applyShopNameFromResult(data);
      }
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "12秒以内に応答しませんでした。"
        : error?.message || String(error);
      setCheck(id, "NG", message);
    }
  };

  runAllChecks = async function() {
    saveToken();
    auditStartedAt.value = performance.now();
    auditTimings.clear();
    showOverall("全検査を実行中です...", "checking");

    const batchSize = 4;
    for (let index = 0; index < checks.length; index += batchSize) {
      const batch = checks.slice(index, index + batchSize);
      await Promise.all(batch.map(item => runCheck(item.id)));
    }

    updateOverallFromState();
  };

  window.copyCheckReport = async function() {
    const lines = [
      `${getShopNameFromPage()} / ${STEP}`,
      `実行日時: ${new Date().toLocaleString("ja-JP")}`,
      `総合結果: ${document.getElementById("overallStatus")?.textContent || "-"}`,
      ""
    ];

    checks.forEach((item, index) => {
      const result = state[item.id] || {};
      lines.push(`${index + 1}. ${item.title}: ${result.status || "未確認"}`);
      if (result.detail) lines.push(result.detail);
      lines.push("");
    });

    await copyText(lines.join("\n"));
    showOverall("検査結果をコピーしました。", "ok");
  };

  function getShopNameFromPage() {
    return String(document.getElementById("pageTitle")?.textContent || "DPRO 車検・整備工場 LINE")
      .replace(" 営業前システム確認", "")
      .trim();
  }

  window.addEventListener("DOMContentLoaded", () => {
    renderChecks();
    renderAuditMetrics();
  });

  window.KSH_NEXT_9_SYSTEM_AUDIT = {
    candidateChecks: extraChecks.map(item => item.id),
    fetchWithTimeout
  };
})();
