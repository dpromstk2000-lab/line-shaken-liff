(() => {
  "use strict";

  const ESTIMATE_VERSION_PATTERN = /^【見積版：(\d+)】\s*/m;
  const ESTIMATE_AMOUNT_PATTERN = /^【見積金額：(\d+)】\s*/m;
  const ESTIMATE_DATE_PATTERN = /^【見積提示日：([^】]+)】\s*/m;
  const ESTIMATE_DETAILS_PATTERN = /^【見積内容：([^】]*)】\s*/m;
  const RECEPTION_PATTERN = /^【受付経路：(LINE|電話|店頭|管理者代理)】\s*/m;
  const PROGRESS_PATTERN = /^【進捗：([^】]+)】\s*/m;
  const ESTIMATE_RESPONSE_MARKER = "【見積回答】";

  const originalRenderReservationCard = renderReservationCard;

  const style = document.createElement("style");
  style.textContent = `
    .member-estimate-box {
      border: 2px solid rgba(241, 196, 15, 0.48);
      background: linear-gradient(135deg, rgba(241, 196, 15, 0.13), rgba(31,31,31,0.98));
      border-radius: 16px;
      padding: 14px;
      margin-top: 10px;
    }
    .member-estimate-box h3 {
      color: #fff2ae;
      font-size: 15px;
      margin: 0;
    }
    .member-estimate-amount {
      font-size: 24px;
      font-weight: 900;
      color: #ffffff;
      margin: 9px 0 3px;
    }
    .member-estimate-details {
      white-space: pre-wrap;
      background: rgba(0,0,0,0.22);
      border: 1px solid #444;
      border-radius: 12px;
      padding: 11px;
      font-size: 12px;
      margin-top: 9px;
    }
    .member-estimate-response {
      margin-top: 10px;
      padding: 10px;
      border-radius: 12px;
      font-size: 12px;
    }
    .member-estimate-response.approved {
      color: #d8ffe8;
      background: rgba(46, 204, 113, 0.12);
      border: 1px solid rgba(46, 204, 113, 0.38);
    }
    .member-estimate-response.change {
      color: #ffd6d6;
      background: rgba(255, 107, 107, 0.12);
      border: 1px solid rgba(255, 107, 107, 0.38);
    }
  `;
  document.head.appendChild(style);

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (error) {
      return String(value || "");
    }
  }

  function parseEstimateMetadata(memo) {
    const text = String(memo || "");
    const version = Number(text.match(ESTIMATE_VERSION_PATTERN)?.[1] || 0);
    const amount = Number(text.match(ESTIMATE_AMOUNT_PATTERN)?.[1] || 0);
    const presentedAt = text.match(ESTIMATE_DATE_PATTERN)?.[1] || "";
    const details = safeDecode(text.match(ESTIMATE_DETAILS_PATTERN)?.[1] || "");

    if (!version && !amount && !details) return null;
    return { version: version || 1, amount, presentedAt, details };
  }

  function stripMemberMetadata(memo) {
    return String(memo || "")
      .replace(RECEPTION_PATTERN, "")
      .replace(PROGRESS_PATTERN, "")
      .replace(ESTIMATE_VERSION_PATTERN, "")
      .replace(ESTIMATE_AMOUNT_PATTERN, "")
      .replace(ESTIMATE_DATE_PATTERN, "")
      .replace(ESTIMATE_DETAILS_PATTERN, "")
      .trim();
  }

  function inferProgressStage(reservation) {
    return String(reservation?.memo || "").match(PROGRESS_PATTERN)?.[1] ||
      String(reservation?.status || "入庫予定");
  }

  function parseEstimateResponseInquiry(inquiry) {
    const message = String(inquiry?.message || "");
    if (!message.includes(ESTIMATE_RESPONSE_MARKER)) return null;

    const reservationId = message.match(/^予約ID：(.+)$/m)?.[1]?.trim() || "";
    const version = Number(message.match(/^見積版：(\d+)$/m)?.[1] || 0);
    const answer = message.match(/^回答：(承認|変更相談)$/m)?.[1] || "";
    const customerMemo = message.match(/^お客様メモ：([\s\S]*)$/m)?.[1]?.trim() || "";

    if (!reservationId || !version || !answer) return null;
    return { reservationId, version, answer, customerMemo, createdAt: inquiry?.created_at || "" };
  }

  function latestResponse(reservation, estimate) {
    return (state.profile?.recentInquiries || [])
      .map(parseEstimateResponseInquiry)
      .filter(Boolean)
      .filter(response =>
        String(response.reservationId) === String(reservation.id) &&
        Number(response.version) === Number(estimate.version)
      )
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
  }

  function yenMember(value) {
    return `${Number(value || 0).toLocaleString("ja-JP")}円`;
  }

  function renderMemberEstimate(reservation) {
    const estimate = parseEstimateMetadata(reservation?.memo || "");
    if (!estimate) return "";

    const response = latestResponse(reservation, estimate);
    const progress = inferProgressStage(reservation);
    const responseHtml = response?.answer === "承認"
      ? `<div class="member-estimate-response approved"><strong>承認済み</strong><br>${escapeHtml(response.customerMemo || "見積内容を承認しました。")}</div>`
      : response?.answer === "変更相談"
        ? `<div class="member-estimate-response change"><strong>内容を相談中</strong><br>${escapeHtml(response.customerMemo || "店舗へ内容確認を送信しました。")}</div>`
        : "";

    const buttons = response?.answer === "承認"
      ? ""
      : `
        <div class="btn-row">
          <button type="button" onclick="submitEstimateResponse('${safeAttr(reservation.id)}','承認')">この見積を承認する</button>
          <button class="secondary" type="button" onclick="submitEstimateResponse('${safeAttr(reservation.id)}','変更相談')">内容を相談する</button>
        </div>
      `;

    return `
      <div class="member-estimate-box">
        <div class="title-row">
          <h3>お見積内容</h3>
          <span class="badge warn">v${estimate.version}</span>
        </div>
        <div class="member-estimate-amount">${escapeHtml(yenMember(estimate.amount))}</div>
        <p class="muted">現在の進捗：${escapeHtml(progress)}</p>
        <div class="member-estimate-details">${escapeHtml(estimate.details || "見積内容は店舗へお問い合わせください。")}</div>
        ${responseHtml}
        ${buttons}
        <p class="tiny" style="margin-top:10px;">承認後、店舗が作業開始へ進めます。追加作業が必要な場合は、改めて確認をご案内します。</p>
      </div>
    `;
  }

  renderReservationCard = function(reservation, vehicles) {
    const vehicle = vehicles.find(v => String(v.id) === String(reservation.vehicle_id));
    const title = vehicle ? vehicleTitle(vehicle) : "登録車両";
    const dateText = [formatDate(reservation.reservation_date), reservation.reservation_time].filter(Boolean).join(" ");
    const progress = inferProgressStage(reservation);
    const plainMemo = stripMemberMetadata(reservation.memo || "");

    return `
      <div class="reservation-card">
        <div class="title-row">
          <h3>${escapeHtml(dateText || "日程未登録")}</h3>
          <span class="badge info">${escapeHtml(progress)}</span>
        </div>
        <p><strong>${escapeHtml(title)}</strong> / ${escapeHtml(reservation.work_type || "作業内容未登録")}</p>
        ${plainMemo ? `<p class="muted">${escapeHtml(plainMemo)}</p>` : ""}
        ${renderMemberEstimate(reservation)}
        <div class="btn-row">
          <button type="button" onclick="copyReservationMessage('${safeAttr(reservation.id)}','change')">日程変更相談</button>
          <button class="warn" type="button" onclick="copyReservationMessage('${safeAttr(reservation.id)}','remind')">入庫前確認</button>
          <button class="danger" type="button" onclick="copyReservationMessage('${safeAttr(reservation.id)}','cancel')">キャンセル相談</button>
        </div>
      </div>
    `;
  };

  function responseStorageKey(reservation, estimate, answer) {
    const userId = state.lineProfile?.userId || state.profile?.customer?.line_user_id || "member";
    return `ksh-estimate-response:${reservation.id}:v${estimate.version}:${answer}:${userId}`;
  }

  function buildResponseMessage(reservation, estimate, answer, customerMemo, responseKey) {
    return [
      ESTIMATE_RESPONSE_MARKER,
      `予約ID：${reservation.id}`,
      `見積版：${estimate.version}`,
      `回答：${answer}`,
      `見積金額：${estimate.amount}`,
      `回答キー：${responseKey}`,
      `お客様メモ：${customerMemo || (answer === "承認" ? "見積内容を承認します。" : "見積内容について確認をお願いします。")}`
    ].join("\n");
  }

  window.submitEstimateResponse = async function(reservationId, answer) {
    const reservation = (state.profile?.recentReservations || [])
      .find(row => String(row.id) === String(reservationId));
    const estimate = parseEstimateMetadata(reservation?.memo || "");

    if (!reservation || !estimate) {
      showToast("見積情報を確認できませんでした。");
      return;
    }

    const vehicle = (state.profile?.vehicles || [])
      .find(row => String(row.id) === String(reservation.vehicle_id));
    const customer = state.profile?.customer || {};

    let customerMemo = "";
    if (answer === "変更相談") {
      customerMemo = window.prompt(
        "確認したい内容や変更希望を入力してください。",
        ""
      ) || "";
      if (!customerMemo.trim()) {
        showToast("相談内容を入力してください。");
        return;
      }
    }

    const confirmText = answer === "承認"
      ? `${yenMember(estimate.amount)}の見積内容を承認しますか？`
      : "入力した内容を店舗へ相談として送信しますか？";
    if (!window.confirm(confirmText)) return;

    const key = responseStorageKey(reservation, estimate, answer);
    if (localStorage.getItem(key) === "sent") {
      showToast("この回答は送信済みです。");
      return;
    }

    const responseKey = `${reservation.id}:v${estimate.version}:${answer}:${Date.now()}`;
    const message = buildResponseMessage(
      reservation,
      estimate,
      answer,
      customerMemo.trim(),
      responseKey
    );

    const payload = {
      shopCode: SHOP_CODE,
      customerId: customer.id || "",
      vehicleId: reservation.vehicle_id || vehicle?.id || "",
      name: customer.name || state.lineProfile?.displayName || "LINE会員",
      phone: customer.phone || "",
      lineUserId: state.lineProfile?.userId || customer.line_user_id || "",
      lineDisplayName: state.lineProfile?.displayName || customer.line_display_name || "",
      carName: vehicleTitle(vehicle || {}),
      plateLast4: vehicle?.plate_last4 || "",
      vehicleLabel: vehicleTitle(vehicle || {}),
      consultType: answer === "承認" ? "見積承認" : "見積変更相談",
      otherConsultDetail: answer,
      preferredVisitDate: "",
      preferredVisitTime: "",
      preferredContactMethod: "LINE",
      shakenYear: "",
      shakenMonth: "",
      mileageKm: "",
      message,
      customerMode: "returning",
      vehicleMode: "registered",
      source: "MEMBER_ESTIMATE_RESPONSE",
      pageUrl: window.location.href
    };

    try {
      if (!state.demo) {
        const response = await fetch(`${WORKER_API_BASE}/api/inquiries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.message || "回答の送信に失敗しました。");
        }
      }

      localStorage.setItem(key, "sent");
      state.profile.recentInquiries = [
        {
          id: `local_${Date.now()}`,
          consult_type: payload.consultType,
          status: "新規相談",
          message,
          created_at: new Date().toISOString()
        },
        ...(state.profile.recentInquiries || [])
      ];

      render();
      showToast(answer === "承認"
        ? "見積を承認しました。店舗へ回答を送信しました。"
        : "確認内容を店舗へ送信しました。");
    } catch (error) {
      console.error(error);
      showToast(error.message || "回答の送信に失敗しました。");
    }
  };

  window.KSH_NEXT_5_ESTIMATE_MEMBER = {
    parseEstimateMetadata,
    parseEstimateResponseInquiry,
    stripMemberMetadata
  };
})();
