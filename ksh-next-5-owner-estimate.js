(() => {
  "use strict";

  const ESTIMATE_VERSION_PATTERN = /^【見積版：(\d+)】\s*/m;
  const ESTIMATE_AMOUNT_PATTERN = /^【見積金額：(\d+)】\s*/m;
  const ESTIMATE_DATE_PATTERN = /^【見積提示日：([^】]+)】\s*/m;
  const ESTIMATE_DETAILS_PATTERN = /^【見積内容：([^】]*)】\s*/m;
  const ESTIMATE_RESPONSE_MARKER = "【見積回答】";

  const originalStripReservationMetadataMarkers = stripReservationMetadataMarkers;
  const originalBuildReservationPayloadFromForm = buildReservationPayloadFromForm;
  const originalOpenNewReservationForm = openNewReservationForm;
  const originalOpenEditReservationForm = openEditReservationForm;
  const originalClearReservationForm = clearReservationForm;
  const originalRenderReservationProgress = renderReservationProgress;
  const originalRenderReservationProgressAction = renderReservationProgressAction;
  const originalAdvanceReservationProgress = advanceReservationProgress;
  const originalLoadReservations = loadReservations;

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (error) {
      return String(value || "");
    }
  }

  function stripEstimateMetadata(memo) {
    return String(memo || "")
      .replace(ESTIMATE_VERSION_PATTERN, "")
      .replace(ESTIMATE_AMOUNT_PATTERN, "")
      .replace(ESTIMATE_DATE_PATTERN, "")
      .replace(ESTIMATE_DETAILS_PATTERN, "")
      .trim();
  }

  function parseEstimateMetadata(memo) {
    const text = String(memo || "");
    const version = Number(text.match(ESTIMATE_VERSION_PATTERN)?.[1] || 0);
    const amount = Number(text.match(ESTIMATE_AMOUNT_PATTERN)?.[1] || 0);
    const presentedAt = text.match(ESTIMATE_DATE_PATTERN)?.[1] || "";
    const encodedDetails = text.match(ESTIMATE_DETAILS_PATTERN)?.[1] || "";
    const details = safeDecode(encodedDetails);

    if (!version && !amount && !details) return null;

    return {
      version: version || 1,
      amount,
      presentedAt,
      details
    };
  }

  function applyEstimateMetadata(memo, estimate) {
    const plain = stripEstimateMetadata(memo);
    const details = encodeURIComponent(String(estimate?.details || "").trim());
    const version = Math.max(1, Number(estimate?.version || 1));
    const amount = Math.max(0, Number(estimate?.amount || 0));
    const presentedAt = String(estimate?.presentedAt || new Date().toISOString());

    return [
      plain,
      `【見積版：${version}】`,
      `【見積金額：${amount}】`,
      `【見積提示日：${presentedAt}】`,
      `【見積内容：${details}】`
    ].filter(Boolean).join("\n");
  }

  stripReservationMetadataMarkers = function(memo) {
    return stripEstimateMetadata(originalStripReservationMetadataMarkers(memo));
  };

  function parseEstimateResponseInquiry(inquiry) {
    const message = String(inquiry?.message || "");
    if (!message.includes(ESTIMATE_RESPONSE_MARKER)) return null;

    const reservationId = message.match(/^予約ID：(.+)$/m)?.[1]?.trim() || "";
    const version = Number(message.match(/^見積版：(\d+)$/m)?.[1] || 0);
    const answer = message.match(/^回答：(承認|変更相談)$/m)?.[1] || "";
    const responseKey = message.match(/^回答キー：(.+)$/m)?.[1]?.trim() || "";
    const customerMemo = message.match(/^お客様メモ：([\s\S]*)$/m)?.[1]?.trim() || "";

    if (!reservationId || !version || !answer) return null;

    return {
      reservationId,
      version,
      answer,
      responseKey,
      customerMemo,
      createdAt: inquiry?.created_at || "",
      inquiry
    };
  }

  function latestEstimateResponse(row, estimate) {
    if (!row?.id || !estimate) return null;

    return (Array.isArray(inquiriesCache) ? inquiriesCache : [])
      .map(parseEstimateResponseInquiry)
      .filter(Boolean)
      .filter(response =>
        String(response.reservationId) === String(row.id) &&
        Number(response.version) === Number(estimate.version)
      )
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
  }

  async function ensureEstimateResponsesLoaded() {
    if (Array.isArray(inquiriesCache) && inquiriesCache.length) return;

    try {
      const data = await api("/api/inquiries?limit=200");
      inquiriesCache = data.inquiries || [];
    } catch (error) {
      console.warn("estimate responses load failed", error);
    }
  }

  loadReservations = async function() {
    await ensureEstimateResponsesLoaded();
    return originalLoadReservations();
  };

  buildReservationPayloadFromForm = function() {
    const payload = originalBuildReservationPayloadFromForm();
    if (!payload) return payload;

    if (editingReservationId) {
      const current = reservationsCache.find(row => String(row.id) === String(editingReservationId));
      const existingEstimate = parseEstimateMetadata(current?.memo || "");
      if (existingEstimate) {
        payload.memo = applyEstimateMetadata(payload.memo, existingEstimate);
      }
    }

    return payload;
  };

  function renderEstimateFormForReservation(reservation) {
    const estimate = parseEstimateMetadata(reservation?.memo || "");
    const response = latestEstimateResponse(reservation, estimate);
    const versionInput = document.getElementById("reservationEstimateVersion");
    const detailsInput = document.getElementById("reservationEstimateDetails");
    const versionBadge = document.getElementById("reservationEstimateVersionBadge");
    const responseBox = document.getElementById("reservationEstimateResponse");
    const publishButton = document.getElementById("reservationEstimatePublishButton");
    const copyButton = document.getElementById("reservationEstimateCopyButton");

    if (versionInput) versionInput.value = String(estimate?.version || 0);
    if (detailsInput) detailsInput.value = estimate?.details || "";

    if (versionBadge) {
      versionBadge.textContent = estimate ? `見積 v${estimate.version}` : "未提示";
      versionBadge.className = `estimate-status-badge ${estimate ? "waiting" : "none"}`;
    }

    if (responseBox) {
      if (!estimate) {
        responseBox.innerHTML = `<span class="estimate-status-badge none">未提示</span><span>見積内容を入力して提示してください。</span>`;
      } else if (response?.answer === "承認") {
        responseBox.innerHTML = `<span class="estimate-status-badge approved">承認済み</span><span>${escapeHtml(response.customerMemo || "お客様が見積内容を承認しました。")}</span>`;
      } else if (response?.answer === "変更相談") {
        responseBox.innerHTML = `<span class="estimate-status-badge change">変更相談あり</span><span>${escapeHtml(response.customerMemo || "お客様から内容確認の希望があります。")}</span>`;
      } else {
        responseBox.innerHTML = `<span class="estimate-status-badge waiting">回答待ち</span><span>マイカーページでの確認を待っています。</span>`;
      }
    }

    const canPublish = Boolean(editingReservationId);
    if (publishButton) publishButton.disabled = !canPublish;
    if (copyButton) copyButton.disabled = !estimate;
  }

  openNewReservationForm = async function() {
    const result = await originalOpenNewReservationForm();
    renderEstimateFormForReservation(null);
    return result;
  };

  openEditReservationForm = async function(reservationId) {
    const result = await originalOpenEditReservationForm(reservationId);
    const reservation = reservationsCache.find(row => String(row.id) === String(reservationId));
    renderEstimateFormForReservation(reservation || null);
    return result;
  };

  clearReservationForm = function(...args) {
    const result = originalClearReservationForm(...args);
    renderEstimateFormForReservation(null);
    return result;
  };

  function estimateStatusForRow(row) {
    const estimate = parseEstimateMetadata(row?.memo || "");
    if (!estimate) return { estimate: null, response: null, label: "見積未提示", className: "none" };

    const response = latestEstimateResponse(row, estimate);
    if (response?.answer === "承認") {
      return { estimate, response, label: "見積承認済み", className: "approved" };
    }
    if (response?.answer === "変更相談") {
      return { estimate, response, label: "見積変更相談", className: "change" };
    }
    return { estimate, response: null, label: "見積回答待ち", className: "waiting" };
  }

  function renderOwnerEstimateSummary(row) {
    const status = estimateStatusForRow(row);
    if (!status.estimate) return "";

    return `
      <div class="estimate-summary-card">
        <strong>${yen(status.estimate.amount)} / v${status.estimate.version}</strong>
        <span class="estimate-status-badge ${status.className}">${escapeHtml(status.label)}</span>
        <div style="margin-top:5px">${escapeHtml(status.estimate.details || "見積内容未入力")}</div>
        ${status.response?.customerMemo ? `<div class="small muted" style="margin-top:5px">お客様：${escapeHtml(status.response.customerMemo)}</div>` : ""}
      </div>
    `;
  }

  renderReservationProgress = function(row) {
    return originalRenderReservationProgress(row) + renderOwnerEstimateSummary(row);
  };

  renderReservationProgressAction = function(row, compact = false) {
    const stage = inferReservationProgressStage(row);
    const status = estimateStatusForRow(row);
    const id = escapeHtml(row?.id || "");

    let baseAction = originalRenderReservationProgressAction(row, compact);

    if (stage === "お客様確認待ち" && status.response?.answer !== "承認") {
      baseAction = "";
    }

    const estimateActions = status.estimate ? `
      <button class="btn btn-slate" onclick="copyEstimateNotice('${id}')">${compact ? "見積案内" : "見積LINE文面"}</button>
    ` : "";

    return baseAction + estimateActions;
  };

  advanceReservationProgress = function(reservationId) {
    const reservation = reservationsCache.find(row => String(row.id) === String(reservationId));
    if (reservation && inferReservationProgressStage(reservation) === "お客様確認待ち") {
      const status = estimateStatusForRow(reservation);
      if (status.response?.answer !== "承認") {
        showError(status.response?.answer === "変更相談"
          ? "お客様から見積内容の変更相談があります。見積を修正して再提示してください。"
          : "お客様の見積承認が確認できるまで作業中へ進めません。");
        return;
      }
    }

    return originalAdvanceReservationProgress(reservationId);
  };

  function buildEstimateNotice(row) {
    const estimate = parseEstimateMetadata(row?.memo || "");
    const customerName = row?.customer?.name || "お客様";
    const vehicleName = row?.vehicle?.car_name || "お車";
    const memberUrl = new URL("member.html", window.location.href).href;

    if (!estimate) return "";

    return `${customerName}様\n\n${vehicleName}の見積をご用意しました。\n見積金額：${yen(estimate.amount)}\n内容：${estimate.details || "マイカーページでご確認ください。"}\n\n下記のマイカーページから内容をご確認いただき、「承認する」または「内容を相談する」を押してください。\n${memberUrl}`;
  }

  window.copyEstimateNotice = async function(reservationId) {
    const row = reservationsCache.find(item => String(item.id) === String(reservationId));
    if (!row || !parseEstimateMetadata(row.memo || "")) {
      showError("見積がまだ提示されていません。");
      return;
    }

    await copyText(buildEstimateNotice(row));
    showOk("見積案内文面をコピーしました。");
  };

  window.copyEstimateNoticeFromForm = async function() {
    if (!editingReservationId) {
      showError("先に保存済みの入庫予定を編集してください。");
      return;
    }
    return window.copyEstimateNotice(editingReservationId);
  };

  window.publishEstimateForCustomer = function() {
    if (!editingReservationId) {
      showError("見積提示は、保存済みの入庫予定を編集して行ってください。");
      return;
    }

    const amount = Number(document.getElementById("reservationEstimatedAmount")?.value || 0);
    const details = String(document.getElementById("reservationEstimateDetails")?.value || "").trim();

    if (amount <= 0) {
      showError("見積金額を1円以上で入力してください。");
      return;
    }
    if (!details) {
      showError("お客様へ提示する見積内容・作業内訳を入力してください。");
      return;
    }

    const current = reservationsCache.find(row => String(row.id) === String(editingReservationId));
    if (!current) {
      showError("対象の入庫予定が見つかりません。");
      return;
    }

    const existing = parseEstimateMetadata(current.memo || "");
    const nextVersion = Number(existing?.version || 0) + 1;

    setReservationProgressStage("お客様確認待ち");
    const payload = originalBuildReservationPayloadFromForm();
    if (!payload) return;

    payload.memo = applyEstimateMetadata(payload.memo, {
      version: nextVersion,
      amount,
      details,
      presentedAt: new Date().toISOString()
    });

    const body = `
      <p class="muted" style="margin-top:0">この見積をマイカーページへ提示します。</p>
      <dl>
        <dt>見積版</dt><dd>v${nextVersion}</dd>
        <dt>見積金額</dt><dd>${escapeHtml(yen(amount))}</dd>
        <dt>見積内容</dt><dd>${escapeHtml(details)}</dd>
        <dt>進捗</dt><dd>お客様確認待ち</dd>
      </dl>
    `;

    showConfirm("見積をお客様へ提示しますか？", body, async () => {
      await updateReservation(payload);
    }, {
      okText: "見積を提示する",
      danger: false
    });
  };

  window.KSH_NEXT_5_ESTIMATE_OWNER = {
    parseEstimateMetadata,
    applyEstimateMetadata,
    parseEstimateResponseInquiry,
    latestEstimateResponse
  };
})();
