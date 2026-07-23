(() => {
  "use strict";

  const RECEPTION_PATTERN = /^【受付経路：(LINE|電話|店頭|管理者代理)】\s*/m;
  const PROGRESS_PATTERN = /^【進捗：([^】]+)】\s*/m;
  const ESTIMATE_VERSION_PATTERN = /^【見積版：(\d+)】\s*/m;
  const ESTIMATE_AMOUNT_PATTERN = /^【見積金額：(\d+)】\s*/m;
  const ESTIMATE_DATE_PATTERN = /^【見積提示日：([^】]+)】\s*/m;
  const ESTIMATE_DETAILS_PATTERN = /^【見積内容：([^】]*)】\s*/m;
  const ESTIMATE_RESPONSE_MARKER = "【見積回答】";

  const PROGRESS_STAGES = [
    "入庫予定",
    "受付・入庫済み",
    "点検中",
    "見積作成中",
    "お客様確認待ち",
    "作業中",
    "最終確認",
    "引渡し可能"
  ];

  const originalOpenMemoModal = openMemoModal;
  const originalSaveMemoModal = saveMemoModal;
  let memoMetadataPrefix = "";

  function stripOperationalMetadata(memo) {
    return String(memo || "")
      .replace(RECEPTION_PATTERN, "")
      .replace(PROGRESS_PATTERN, "")
      .replace(ESTIMATE_VERSION_PATTERN, "")
      .replace(ESTIMATE_AMOUNT_PATTERN, "")
      .replace(ESTIMATE_DATE_PATTERN, "")
      .replace(ESTIMATE_DETAILS_PATTERN, "")
      .trim();
  }

  function metadataLines(memo) {
    return String(memo || "")
      .split(/\r?\n/)
      .filter(line =>
        /^【受付経路：/.test(line) ||
        /^【進捗：/.test(line) ||
        /^【見積版：/.test(line) ||
        /^【見積金額：/.test(line) ||
        /^【見積提示日：/.test(line) ||
        /^【見積内容：/.test(line)
      )
      .join("\n");
  }

  function inferReceptionChannel(row) {
    return String(row?.memo || "").match(RECEPTION_PATTERN)?.[1] ||
      (row?.inquiry_id ? "LINE" : "未記録");
  }

  function inferProgressStage(row) {
    const explicit = String(row?.memo || "").match(PROGRESS_PATTERN)?.[1] || "";
    if (explicit) return explicit;

    const status = String(row?.status || "");
    if (status.includes("仮入庫")) return "仮入庫";
    if (status.includes("作業完了")) return "引渡し完了";
    if (status.includes("作業中")) return "作業中";
    if (status.includes("入庫済み")) return "受付・入庫済み";
    return "入庫予定";
  }

  function broadStatus(stage) {
    if (stage === "仮入庫") return "仮入庫";
    if (stage === "入庫予定") return "入庫予定";
    if (stage === "受付・入庫済み") return "入庫済み";
    if (stage === "引渡し完了") return "作業完了";
    return "作業中";
  }

  function applyProgress(row, stage) {
    const currentMemo = String(row?.memo || "");
    const currentReception = currentMemo.match(RECEPTION_PATTERN)?.[0]?.trim() ||
      `【受付経路：${inferReceptionChannel(row) === "未記録" ? "管理者代理" : inferReceptionChannel(row)}】`;

    const estimateLines = currentMemo
      .split(/\r?\n/)
      .filter(line =>
        /^【見積版：/.test(line) ||
        /^【見積金額：/.test(line) ||
        /^【見積提示日：/.test(line) ||
        /^【見積内容：/.test(line)
      );

    return [
      currentReception,
      `【進捗：${stage}】`,
      ...estimateLines,
      stripOperationalMetadata(currentMemo)
    ].filter(Boolean).join("\n");
  }

  function parseEstimate(row) {
    const memo = String(row?.memo || "");
    const version = Number(memo.match(ESTIMATE_VERSION_PATTERN)?.[1] || 0);
    const amount = Number(memo.match(ESTIMATE_AMOUNT_PATTERN)?.[1] || 0);
    if (!version && !amount) return null;
    return { version: version || 1, amount };
  }

  function parseEstimateResponse(inquiry) {
    const message = String(inquiry?.message || "");
    if (!message.includes(ESTIMATE_RESPONSE_MARKER)) return null;
    return {
      reservationId: message.match(/^予約ID：(.+)$/m)?.[1]?.trim() || "",
      version: Number(message.match(/^見積版：(\d+)$/m)?.[1] || 0),
      answer: message.match(/^回答：(承認|変更相談)$/m)?.[1] || "",
      memo: message.match(/^お客様メモ：([\s\S]*)$/m)?.[1]?.trim() || "",
      createdAt: inquiry?.created_at || ""
    };
  }

  function estimateResponse(row) {
    const estimate = parseEstimate(row);
    if (!estimate) return null;
    return (dashboardCache?.recentInquiries || [])
      .map(parseEstimateResponse)
      .filter(Boolean)
      .filter(item =>
        String(item.reservationId) === String(row.id) &&
        Number(item.version) === Number(estimate.version)
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }

  function stageClass(stage) {
    if (stage === "引渡し可能") return "ready";
    if (stage === "仮入庫" || stage === "お客様確認待ち") return "attention";
    if (stage === "入庫予定") return "waiting";
    return "";
  }

  function stageBadge(row) {
    const stage = inferProgressStage(row);
    return `<span class="ipad-stage-badge ${stageClass(stage)}">${escapeHtml(stage)}</span>`;
  }

  function renderProgressTrack(row) {
    const stage = inferProgressStage(row);
    const index = PROGRESS_STAGES.indexOf(stage);
    const complete = stage === "引渡し完了";
    const parts = PROGRESS_STAGES.map((_, itemIndex) => {
      let cls = "";
      if (complete) cls = "complete";
      else if (itemIndex < index) cls = "done";
      else if (itemIndex === index) cls = "current";
      return `<span class="${cls}"></span>`;
    }).join("");
    return `<div class="ipad-next-progress" aria-label="${escapeHtml(stage)}">${parts}</div>`;
  }

  function nextStage(row) {
    const stage = inferProgressStage(row);
    if (stage === "仮入庫") return "入庫予定";
    const index = PROGRESS_STAGES.indexOf(stage);
    if (index < 0 || index >= PROGRESS_STAGES.length - 1) return "";
    return PROGRESS_STAGES[index + 1];
  }

  function laneFor(row) {
    const stage = inferProgressStage(row);
    if (stage === "引渡し可能") return "ready";
    if (["受付・入庫済み", "点検中", "見積作成中", "お客様確認待ち", "作業中", "最終確認"].includes(stage)) {
      return "working";
    }
    return "arrival";
  }

  function estimateStatusHtml(row) {
    const estimate = parseEstimate(row);
    if (!estimate) return "";
    const response = estimateResponse(row);
    const label = response?.answer === "承認"
      ? "見積承認済み"
      : response?.answer === "変更相談"
        ? "見積変更相談あり"
        : "見積回答待ち";
    return `<div class="ipad-estimate-note">${escapeHtml(label)} / ${Number(estimate.amount || 0).toLocaleString("ja-JP")}円${response?.memo ? `<br>${escapeHtml(response.memo)}` : ""}</div>`;
  }

  function canAdvance(row) {
    const stage = inferProgressStage(row);
    if (stage !== "お客様確認待ち") return true;
    return estimateResponse(row)?.answer === "承認";
  }

  function primaryAction(row) {
    const stage = inferProgressStage(row);
    const next = nextStage(row);
    const id = escapeAttr(row.id || "");

    if (stage === "引渡し可能") {
      return `<button class="btn btn-green" onclick="goBackToPc()">PCで引渡し完了</button>`;
    }

    if (stage === "お客様確認待ち" && !canAdvance(row)) {
      const response = estimateResponse(row);
      return `<button class="btn btn-orange" disabled>${response?.answer === "変更相談" ? "見積変更相談あり" : "見積承認待ち"}</button>`;
    }

    if (!next) return "";
    return `<button class="btn ${next === "入庫予定" ? "btn-green" : "btn-primary"}" onclick="advanceIpadProgress('${id}')">${escapeHtml(next)}へ</button>`;
  }

  window.advanceIpadProgress = async function(reservationId) {
    const row = findReservation(reservationId);
    if (!row) {
      showError("対象の入庫予定が見つかりません。");
      return;
    }

    const current = inferProgressStage(row);
    const next = nextStage(row);
    if (!next) {
      showError("次の進捗はありません。");
      return;
    }

    if (!canAdvance(row)) {
      showError("見積承認が確認できるまで作業開始へ進めません。");
      return;
    }

    const name = row.customer?.name || row.customer_name || "お客様";
    if (!confirm(`${name}様の進捗を「${current}」から「${next}」へ進めますか？`)) return;

    await patchReservation(row, {
      status: broadStatus(next),
      memo: applyProgress(row, next)
    });
  };

  window.openIpadIntake = function(channel) {
    switchTab("intake");
    const select = document.getElementById("intakeReceptionChannel");
    if (select) select.value = ["電話", "店頭", "管理者代理"].includes(channel) ? channel : "電話";
    window.setTimeout(() => document.getElementById("intakeName")?.focus(), 150);
  };

  renderTodaySummary = function() {
    const all = uniqueReservations([
      ...todayReservationsCache,
      ...reservationsCache
    ]).filter(row => !isHiddenReservation(row));

    const today = dateYmd(new Date());
    const arrival = all.filter(row =>
      laneFor(row) === "arrival" &&
      normalizeDateInput(row.reservation_date || "") === today &&
      !isProvisionalReservationStatus(row.status)
    );
    const working = all.filter(row => laneFor(row) === "working");
    const ready = all.filter(row => laneFor(row) === "ready");
    const openTasks = todayTasksCache.length + provisionalReservationsCache.length;

    setText("countArrivalWaiting", `${arrival.length}件`);
    setText("countWorking", `${working.length}件`);
    setText("countReady", `${ready.length}件`);
    setText("countOpenTasks", `${openTasks}件`);
    setText("countTodayReservations", `${todayReservationsCache.length}件`);
    setText("countProvisional", `${provisionalReservationsCache.length}件`);
    setText("provisionalSummaryCount", `${provisionalReservationsCache.length}件`);
    setText("todayTaskSummaryCount", `${todayTasksCache.length}件`);
  };

  renderTodayReservations = function() {
    const today = dateYmd(new Date());
    const all = uniqueReservations([
      ...todayReservationsCache,
      ...reservationsCache
    ])
      .filter(row => !isHiddenReservation(row))
      .sort(sortReservations);

    const arrival = all.filter(row =>
      laneFor(row) === "arrival" &&
      normalizeDateInput(row.reservation_date || "") === today &&
      !isProvisionalReservationStatus(row.status)
    );
    const working = all.filter(row => laneFor(row) === "working");
    const ready = all.filter(row => laneFor(row) === "ready");

    const fill = (id, rows, emptyText) => {
      const box = document.getElementById(id);
      if (!box) return;
      box.innerHTML = rows.length
        ? rows.map(row => renderReservationCard(row, "today")).join("")
        : `<div class="ipad-empty-lane">${escapeHtml(emptyText)}</div>`;
    };

    fill("arrivalReservationList", arrival, "現在、到着待ちはありません。");
    fill("workingReservationList", working, "現在、進行中の作業はありません。");
    fill("readyReservationList", ready, "現在、引渡し待ちはありません。");
  };

  renderReservationCard = function(row, mode) {
    const customer = row.customer || {};
    const vehicle = row.vehicle || {};
    const time = row.reservation_time ? String(row.reservation_time).slice(0, 5) : "未定";
    const date = normalizeDateInput(row.reservation_date || "");
    const customerName = customer.name || row.customer_name || "お客様";
    const phone = customer.phone || row.customer_phone || "";
    const vehicleText = buildVehicleLabel(vehicle, row);
    const work = row.work_type || "作業";
    const memo = stripOperationalMetadata(row.memo || row.completion_memo || "");
    const reception = inferReceptionChannel(row);
    const compactDate = mode === "today" ? "本日" : formatDateShort(date);

    return `
      <article class="work-card ipad-compact ${getReservationCardClass(row.status || "")}">
        <div class="work-head">
          <div class="time-badge">${escapeHtml(time)}<small>${escapeHtml(compactDate)}</small></div>
          <div class="work-title">
            <div class="customer-name">${escapeHtml(customerName)} 様</div>
            <div class="work-sub">${escapeHtml(vehicleText)} / ${escapeHtml(work)}</div>
          </div>
          ${stageBadge(row)}
        </div>

        <div class="compact-line">
          <span class="compact-chip">受付：${escapeHtml(reception)}</span>
          <span class="compact-chip">📞 ${escapeHtml(phone || "電話未入力")}</span>
        </div>

        ${renderProgressTrack(row)}
        ${estimateStatusHtml(row)}

        <details class="compact-details">
          <summary>詳細・メモ</summary>
          <div class="compact-details-body">
入庫日：${escapeHtml(formatDate(date))}
作業内容：${escapeHtml(work)}
車両：${escapeHtml(vehicleText)}
メモ：${escapeHtml(memo || "メモなし")}
          </div>
        </details>

        <div class="actions">
          ${primaryAction(row)}
          <button class="btn btn-primary" onclick="copyReservationMessage('${escapeAttr(row.id)}')">LINE文面</button>
          <button class="btn btn-slate" onclick="openMemoModal('${escapeAttr(row.id)}')">メモ</button>
        </div>
      </article>
    `;
  };

  openMemoModal = function(reservationId) {
    const row = findReservation(reservationId);
    if (!row) {
      showError("対象の入庫予定が見つかりません。");
      return;
    }
    memoMetadataPrefix = metadataLines(row.memo || "");
    editingMemoReservationId = reservationId;
    document.getElementById("memoModalTitle").textContent = `${row.customer?.name || "お客様"}様のメモ編集`;
    document.getElementById("memoInput").value = stripOperationalMetadata(row.memo || "");
    document.getElementById("memoModal").classList.add("active");
    setTimeout(() => document.getElementById("memoInput")?.focus(), 80);
  };

  saveMemoModal = async function() {
    const row = findReservation(editingMemoReservationId);
    if (!row) {
      showError("対象の入庫予定が見つかりません。");
      return;
    }
    const plain = document.getElementById("memoInput").value.trim();
    const combined = [memoMetadataPrefix, plain].filter(Boolean).join("\n");
    await patchReservation(row, { memo: combined });
    memoMetadataPrefix = "";
    closeMemoModal();
  };

  const originalResetIntakeForm = resetIntakeForm;
  resetIntakeForm = function() {
    const result = originalResetIntakeForm();
    const select = document.getElementById("intakeReceptionChannel");
    if (select) select.value = "電話";
    return result;
  };

  const originalResetIntakeFormWithoutToast = resetIntakeFormWithoutToast;
  resetIntakeFormWithoutToast = function() {
    const result = originalResetIntakeFormWithoutToast();
    const select = document.getElementById("intakeReceptionChannel");
    if (select) select.value = "電話";
    return result;
  };

  window.KSH_NEXT_6_IPAD = {
    inferProgressStage,
    inferReceptionChannel,
    laneFor,
    applyProgress,
    parseEstimate,
    estimateResponse
  };
})();
