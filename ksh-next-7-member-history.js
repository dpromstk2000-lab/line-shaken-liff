(() => {
  "use strict";

  const RECEPTION_PATTERN = /^【受付経路：(LINE|電話|店頭|管理者代理)】\s*/m;
  const PROGRESS_PATTERN = /^【進捗：([^】]+)】\s*/m;
  const ESTIMATE_VERSION_PATTERN = /^【見積版：(\d+)】\s*/m;
  const ESTIMATE_AMOUNT_PATTERN = /^【見積金額：(\d+)】\s*/m;
  const ESTIMATE_DATE_PATTERN = /^【見積提示日：([^】]+)】\s*/m;
  const ESTIMATE_DETAILS_PATTERN = /^【見積内容：([^】]*)】\s*/m;

  const PROGRESS_STAGES = [
    "入庫予定",
    "受付・入庫済み",
    "点検中",
    "見積作成中",
    "お客様確認待ち",
    "作業中",
    "最終確認",
    "引渡し可能",
    "引渡し完了"
  ];

  const estimateAwareReservationCard = renderReservationCard;
  const originalBuildDemoProfile = buildDemoProfile;

  const style = document.createElement("style");
  style.textContent = `
    /* STEP KSH-NEXT-7: MEMBER HISTORY */
    .member-next-intro {
      border-color: rgba(56, 189, 248, 0.35);
      background:
        radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 45%),
        rgba(31, 31, 31, 0.97);
    }

    .member-overview {
      border: 2px solid rgba(230, 126, 34, 0.42);
      background:
        linear-gradient(135deg, rgba(230, 126, 34, 0.14), rgba(31, 31, 31, 0.98));
    }

    .member-overview-name {
      font-size: 20px;
      font-weight: 950;
      letter-spacing: 0.4px;
    }

    .member-overview-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 13px;
    }

    .member-current-card {
      border: 2px solid rgba(56, 189, 248, 0.42);
      background:
        linear-gradient(135deg, rgba(56, 189, 248, 0.08), #151515);
    }

    .member-progress-box {
      margin: 9px 0 11px;
      padding: 10px;
      border: 1px solid #343434;
      border-radius: 13px;
      background: rgba(0, 0, 0, 0.18);
    }

    .member-progress-head {
      display: flex;
      justify-content: space-between;
      gap: 9px;
      align-items: center;
      margin-bottom: 8px;
    }

    .member-progress-head strong {
      color: #d7f2ff;
      font-size: 13px;
    }

    .member-progress-track {
      display: grid;
      grid-template-columns: repeat(9, minmax(8px, 1fr));
      gap: 3px;
    }

    .member-progress-track span {
      height: 7px;
      border-radius: 999px;
      background: #333;
    }

    .member-progress-track span.done { background: #38bdf8; }
    .member-progress-track span.current {
      background: #f1c40f;
      box-shadow: 0 0 0 2px rgba(241, 196, 15, 0.14);
    }
    .member-progress-track span.complete { background: #2ecc71; }

    .member-progress-labels {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 7px;
      color: #858585;
      font-size: 10px;
    }

    .vehicle-next-card {
      border: 1px solid var(--line);
      background: #151515;
      border-radius: 16px;
      padding: 14px;
      margin-top: 10px;
    }

    .vehicle-next-alerts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 11px;
    }

    .vehicle-next-item {
      border: 1px solid #343434;
      border-radius: 13px;
      padding: 10px;
      background: #111;
      min-height: 78px;
    }

    .vehicle-next-item .label {
      color: var(--muted);
      font-size: 10px;
    }

    .vehicle-next-item .value {
      margin-top: 4px;
      color: #fff;
      font-size: 13px;
      font-weight: 900;
    }

    .vehicle-next-item .sub {
      margin-top: 2px;
      color: #8d8d8d;
      font-size: 10px;
    }

    .vehicle-history-group {
      margin-top: 11px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #151515;
      overflow: hidden;
    }

    .vehicle-history-group > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      padding: 14px;
      font-size: 14px;
      font-weight: 900;
    }

    .vehicle-history-group > summary::-webkit-details-marker {
      display: none;
    }

    .vehicle-history-group > summary::before {
      content: "＋";
      color: var(--accent2);
      font-size: 18px;
    }

    .vehicle-history-group[open] > summary::before {
      content: "－";
    }

    .vehicle-history-body {
      padding: 0 12px 12px;
    }

    .maintenance-history-card {
      border-top: 1px solid #303030;
      padding: 13px 2px;
    }

    .maintenance-history-card:first-child {
      border-top: none;
    }

    .maintenance-history-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }

    .maintenance-history-date {
      color: #fff;
      font-size: 13px;
      font-weight: 900;
    }

    .maintenance-history-work {
      margin-top: 3px;
      color: #d4d4d4;
      font-size: 12px;
    }

    .maintenance-history-detail {
      margin-top: 8px;
      padding: 9px 10px;
      border-radius: 11px;
      background: #111;
      color: #bdbdbd;
      font-size: 11px;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .next-recommendation {
      margin-top: 8px;
      border: 1px solid rgba(46, 204, 113, 0.32);
      background: rgba(46, 204, 113, 0.08);
      color: #d8ffe8;
      border-radius: 11px;
      padding: 9px 10px;
      font-size: 11px;
      line-height: 1.55;
    }

    .history-secondary-details {
      margin-top: 12px;
      border: 1px solid #303030;
      border-radius: 14px;
      overflow: hidden;
    }

    .history-secondary-details > summary {
      cursor: pointer;
      list-style: none;
      padding: 12px;
      color: #bdbdbd;
      font-size: 12px;
      font-weight: 850;
      background: #151515;
    }

    .history-secondary-details > summary::-webkit-details-marker {
      display: none;
    }

    .history-secondary-body {
      padding: 0 10px 10px;
    }

    .member-refresh {
      width: auto;
      min-height: 38px;
      padding: 8px 11px;
      font-size: 11px;
    }

    @media (max-width: 460px) {
      .member-overview-grid {
        grid-template-columns: 1fr;
      }

      .vehicle-next-alerts {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);

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
    const explicit = String(reservation?.memo || "").match(PROGRESS_PATTERN)?.[1] || "";
    if (explicit) return explicit;

    const status = String(reservation?.status || "");
    if (status.includes("キャンセル") || status.includes("削除")) return "キャンセル";
    if (
      status.includes("作業完了") ||
      status.includes("納車済") ||
      status.includes("引渡し完了")
    ) return "引渡し完了";
    if (status.includes("作業中")) return "作業中";
    if (status.includes("入庫済")) return "受付・入庫済み";
    if (status.includes("仮入庫")) return "仮入庫";
    return "入庫予定";
  }

  function isCancelledReservation(reservation) {
    return inferProgressStage(reservation) === "キャンセル";
  }

  function isCompletedReservation(reservation) {
    return inferProgressStage(reservation) === "引渡し完了" ||
      Boolean(reservation?.completed_date);
  }

  function isCurrentReservation(reservation) {
    return !isCancelledReservation(reservation) && !isCompletedReservation(reservation);
  }

  function reservationSortDate(reservation) {
    return String(
      reservation?.completed_date ||
      reservation?.reservation_date ||
      reservation?.updated_at ||
      reservation?.created_at ||
      ""
    );
  }

  function reservationsForVehicle(vehicleId, reservations) {
    return (reservations || [])
      .filter(row => String(row.vehicle_id || "") === String(vehicleId || ""))
      .sort((a, b) => reservationSortDate(b).localeCompare(reservationSortDate(a)));
  }

  function progressIndex(stage) {
    if (stage === "仮入庫") return 0;
    const index = PROGRESS_STAGES.indexOf(stage);
    return index < 0 ? 0 : index;
  }

  function renderProgressBox(reservation) {
    const stage = inferProgressStage(reservation);
    const index = progressIndex(stage);
    const complete = stage === "引渡し完了";
    const segments = PROGRESS_STAGES.map((_, itemIndex) => {
      let cls = "";
      if (complete) cls = "complete";
      else if (itemIndex < index) cls = "done";
      else if (itemIndex === index) cls = "current";
      return `<span class="${cls}"></span>`;
    }).join("");

    return `
      <div class="member-progress-box">
        <div class="member-progress-head">
          <strong>現在の進捗：${escapeHtml(stage)}</strong>
          <span class="badge ${complete ? "ok" : "info"}">${complete ? "完了" : `${Math.min(index + 1, PROGRESS_STAGES.length)}/${PROGRESS_STAGES.length}`}</span>
        </div>
        <div class="member-progress-track" aria-label="${escapeHtml(stage)}">${segments}</div>
        <div class="member-progress-labels"><span>受付</span><span>点検・見積・作業</span><span>引渡し</span></div>
      </div>
    `;
  }

  renderReservationCard = function(reservation, vehicles) {
    const base = estimateAwareReservationCard(reservation, vehicles);
    const marker = "<p><strong>";
    if (!base.includes(marker)) return base;
    return base
      .replace('class="reservation-card"', 'class="reservation-card member-current-card"', 1)
      .replace(marker, `${renderProgressBox(reservation)}${marker}`, 1);
  };

  function nearestNextDate(vehicles) {
    const candidates = [];
    for (const vehicle of vehicles || []) {
      if (vehicle.next_shaken_date) {
        candidates.push({
          type: "車検",
          date: vehicle.next_shaken_date,
          vehicle
        });
      }
      if (vehicle.next_oil_change_date) {
        candidates.push({
          type: "オイル交換",
          date: vehicle.next_oil_change_date,
          vehicle
        });
      }
    }
    return candidates
      .filter(item => item.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  }

  function renderMemberOverview(profile) {
    const customer = profile.customer || {};
    const vehicles = profile.vehicles || [];
    const reservations = profile.recentReservations || [];
    const current = reservations.filter(isCurrentReservation);
    const completed = reservations.filter(isCompletedReservation);
    const nearest = nearestNextDate(vehicles);

    return `
      <section class="card member-overview">
        <div class="title-row">
          <div>
            <div class="member-overview-name">${escapeHtml(customer.name || "お客様")} 様</div>
            <p class="muted">${escapeHtml(customer.line_display_name || state.lineProfile?.displayName || "LINE会員")} / ${escapeHtml(customer.phone || "電話番号未登録")}</p>
          </div>
          <button class="secondary member-refresh" type="button" onclick="location.reload()">更新</button>
        </div>
        <div class="member-overview-grid">
          <div class="stat">
            <div class="label">現在対応中</div>
            <div class="value">${current.length} 件</div>
            <div class="sub">予約・点検・整備中</div>
          </div>
          <div class="stat">
            <div class="label">登録車両</div>
            <div class="value">${vehicles.length} 台</div>
            <div class="sub">車両ごとに履歴管理</div>
          </div>
          <div class="stat">
            <div class="label">直近整備履歴</div>
            <div class="value">${completed.length} 件</div>
            <div class="sub">会員APIで取得できた範囲</div>
          </div>
        </div>
        ${nearest ? `
          <div class="notice" style="margin-top:12px; margin-bottom:0">
            次に近い目安：<strong>${escapeHtml(vehicleTitle(nearest.vehicle))}</strong>の
            ${escapeHtml(nearest.type)}／${escapeHtml(formatDate(nearest.date))}（${escapeHtml(daysText(nearest.date))}）
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderCurrentWork(reservations, vehicles) {
    const current = (reservations || [])
      .filter(isCurrentReservation)
      .sort((a, b) => reservationSortDate(a).localeCompare(reservationSortDate(b)))
      .slice(0, 8);

    if (!current.length) {
      return `
        <section class="card">
          <div class="title-row"><h2>現在の整備状況</h2><span class="badge ok">対応中なし</span></div>
          <div class="empty">現在、予約中・入庫中・作業中のお車はありません。</div>
        </section>
      `;
    }

    return `
      <section class="card">
        <div class="title-row">
          <h2>現在の整備状況</h2>
          <span class="badge info">${current.length}件</span>
        </div>
        <p class="muted">予約から引渡しまでの現在位置を確認できます。</p>
        ${current.map(reservation => renderReservationCard(reservation, vehicles)).join("")}
      </section>
    `;
  }

  function dateItem(label, date, type) {
    const status = dateStatus(date, type);
    return `
      <div class="vehicle-next-item">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(date ? formatDate(date) : "未登録")}</div>
        <div class="sub">${escapeHtml(date ? status.label : "店舗で登録すると表示されます")}</div>
      </div>
    `;
  }

  function latestCompletedReservation(vehicleId, reservations) {
    return reservationsForVehicle(vehicleId, reservations)
      .find(isCompletedReservation) || null;
  }

  function renderVehicleNextCard(vehicle, reservations) {
    const vehicleReservations = reservationsForVehicle(vehicle.id, reservations);
    const completed = vehicleReservations.filter(isCompletedReservation);
    const latest = completed[0] || null;
    const lastDate =
      latest?.completed_date ||
      vehicle.last_work_completed_date ||
      vehicle.last_visit_date ||
      latest?.reservation_date ||
      "";
    const nextOil = latest?.next_oil_change_date || vehicle.next_oil_change_date || "";
    const nextShaken = vehicle.next_shaken_date || buildNextShakenDate(latest);
    const proposal = latest?.next_proposal_memo || vehicle.next_proposal_memo || "";

    return `
      <div class="vehicle-next-card">
        <div class="vehicle-head">
          <div>
            <div class="vehicle-name">${escapeHtml(vehicleTitle(vehicle))}</div>
            <div class="muted">ナンバー下4桁：${escapeHtml(vehicle.plate_last4 || "未登録")}</div>
          </div>
          <span class="badge info">履歴 ${completed.length}件</span>
        </div>
        <div class="meta-row">
          <span class="badge">メーカー：${escapeHtml(vehicle.maker || "未登録")}</span>
          <span class="badge">型式：${escapeHtml(vehicle.model || "未登録")}</span>
        </div>
        <div class="vehicle-next-alerts">
          ${dateItem("次回車検目安", nextShaken, "車検")}
          ${dateItem("オイル交換目安", nextOil, "オイル")}
        </div>
        <ul class="info-list">
          <li><span>最終整備・引渡し</span><strong>${escapeHtml(lastDate ? formatDate(lastDate) : "未登録")}</strong></li>
          <li><span>次回提案</span><strong>${escapeHtml(proposal || "未登録")}</strong></li>
        </ul>
        <div class="btn-row">
          <a class="link-btn" href="index.html?v=step-ksh-next-7&vehicleId=${encodeURIComponent(vehicle.id || "")}">この車で相談する</a>
          ${latest ? `<button class="secondary" type="button" onclick="copyRepeatMaintenance('${safeAttr(latest.id)}')">前回と同じ内容で相談</button>` : ""}
        </div>
      </div>
    `;
  }

  function buildNextShakenDate(reservation) {
    const year = Number(reservation?.next_shaken_year || 0);
    const month = Number(reservation?.next_shaken_month || 0);
    if (!year || !month) return "";
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  function renderVehicleMaintenance(vehicles, reservations) {
    if (!vehicles.length) {
      return `
        <section class="card">
          <div class="title-row"><h2>マイカーと次回目安</h2><span class="badge warn">車両未登録</span></div>
          <div class="empty">相談フォームからお車を登録してください。</div>
        </section>
      `;
    }

    return `
      <section class="card">
        <div class="title-row"><h2>マイカーと次回目安</h2><span class="badge info">${vehicles.length}台</span></div>
        <p class="muted">車検・オイル交換・最終整備・次回提案を車両ごとに確認できます。</p>
        ${vehicles.map(vehicle => renderVehicleNextCard(vehicle, reservations)).join("")}
      </section>
    `;
  }

  function yenHistory(value) {
    const amount = Number(value || 0);
    return amount > 0 ? `${amount.toLocaleString("ja-JP")}円` : "";
  }

  function renderMaintenanceHistoryItem(reservation) {
    const date =
      reservation.completed_date ||
      reservation.reservation_date ||
      "";
    const detail =
      reservation.completion_memo ||
      stripMemberMetadata(reservation.memo || "") ||
      "";
    const nextItems = [
      reservation.next_proposal_memo
        ? `次回提案：${reservation.next_proposal_memo}`
        : "",
      reservation.next_oil_change_date
        ? `オイル交換目安：${formatDate(reservation.next_oil_change_date)}`
        : "",
      buildNextShakenDate(reservation)
        ? `次回車検目安：${formatDate(buildNextShakenDate(reservation))}`
        : ""
    ].filter(Boolean);

    return `
      <div class="maintenance-history-card">
        <div class="maintenance-history-top">
          <div>
            <div class="maintenance-history-date">${escapeHtml(date ? formatDate(date) : "完了日未登録")}</div>
            <div class="maintenance-history-work">${escapeHtml(reservation.work_type || "整備・作業")}</div>
          </div>
          <span class="badge ok">完了</span>
        </div>
        ${yenHistory(reservation.actual_sales_amount)
          ? `<div class="meta-row"><span class="badge">${escapeHtml(yenHistory(reservation.actual_sales_amount))}</span></div>`
          : ""}
        ${detail ? `<div class="maintenance-history-detail">${escapeHtml(detail)}</div>` : ""}
        ${nextItems.length ? `<div class="next-recommendation">${nextItems.map(escapeHtml).join("<br>")}</div>` : ""}
        <div class="btn-row">
          <button class="secondary" type="button" onclick="copyRepeatMaintenance('${safeAttr(reservation.id)}')">前回と同じ内容で相談</button>
        </div>
      </div>
    `;
  }

  function renderMaintenanceHistory(vehicles, reservations, inquiries) {
    const completedAll = (reservations || [])
      .filter(isCompletedReservation)
      .sort((a, b) => reservationSortDate(b).localeCompare(reservationSortDate(a)));

    const vehicleGroups = (vehicles || []).map(vehicle => ({
      vehicle,
      reservations: completedAll
        .filter(row => String(row.vehicle_id || "") === String(vehicle.id || ""))
        .slice(0, 8)
    }));

    const withoutVehicle = completedAll
      .filter(row => !row.vehicle_id)
      .slice(0, 5);

    return `
      <section class="card soft">
        <div class="title-row">
          <h2>車両別の整備履歴</h2>
          <span class="badge">${completedAll.length}件</span>
        </div>
        <p class="muted">会員APIから取得できた直近履歴です。車両名を押すと開きます。</p>
        ${vehicleGroups.map((group, index) => `
          <details class="vehicle-history-group" ${index === 0 ? "open" : ""}>
            <summary>
              <span>${escapeHtml(vehicleTitle(group.vehicle))}</span>
              <span class="badge">${group.reservations.length}件</span>
            </summary>
            <div class="vehicle-history-body">
              ${group.reservations.length
                ? group.reservations.map(renderMaintenanceHistoryItem).join("")
                : `<div class="empty">この車両の完了履歴はまだありません。</div>`}
            </div>
          </details>
        `).join("")}
        ${withoutVehicle.length ? `
          <details class="vehicle-history-group">
            <summary><span>車両未関連の履歴</span><span class="badge">${withoutVehicle.length}件</span></summary>
            <div class="vehicle-history-body">${withoutVehicle.map(renderMaintenanceHistoryItem).join("")}</div>
          </details>
        ` : ""}
        <details class="history-secondary-details">
          <summary>相談受付の履歴も見る</summary>
          <div class="history-secondary-body">
            ${(inquiries || []).filter(inquiry => !String(inquiry.message || "").includes("【見積回答】")).slice(0, 6).map(renderInquiryHistory).join("") ||
              `<div class="empty">最近の相談履歴はありません。</div>`}
          </div>
        </details>
      </section>
    `;
  }

  window.copyRepeatMaintenance = function(reservationId) {
    const reservations = state.profile?.recentReservations || [];
    const vehicles = state.profile?.vehicles || [];
    const customer = state.profile?.customer || {};
    const reservation = reservations.find(row => String(row.id) === String(reservationId));
    const vehicle = vehicles.find(row => String(row.id) === String(reservation?.vehicle_id));

    if (!reservation) {
      showToast("前回の整備履歴を確認できませんでした。");
      return;
    }

    const detail =
      reservation.completion_memo ||
      stripMemberMetadata(reservation.memo || "") ||
      "前回と同じ作業";

    const message = `${state.shop.shop_name} 様

${customer.name || ""}です。
${vehicle ? `${vehicleTitle(vehicle)}（ナンバー下4桁：${vehicle.plate_last4 || "未登録"}）` : "登録している車"}について、前回と同じ内容で相談したいです。

前回の作業：${reservation.work_type || "整備・作業"}
前回の内容：${detail}
希望日：
希望時間：

よろしくお願いします。`;

    copyText(message, "前回と同じ整備相談");
  };

  render = function() {
    const app = document.getElementById("app");
    const alertArea = document.getElementById("alertArea");
    alertArea.innerHTML = "";

    if (state.demo) {
      alertArea.innerHTML = `<div class="notice">これは会員ページの表示例です。実データは保存していません。</div>`;
    }

    if (state.loading) {
      app.innerHTML = `<section class="card loading">会員情報を読み込み中です...</section>`;
      return;
    }

    if (state.error) {
      app.innerHTML = `
        <section class="card">
          <div class="danger-box">${escapeHtml(state.error)}</div>
          ${renderPrimaryActions()}
        </section>`;
      return;
    }

    if (!state.profile || !state.profile.found) {
      app.innerHTML = renderNoProfile();
      return;
    }

    const profile = state.profile;
    const vehicles = profile.vehicles || [];
    const reservations = profile.recentReservations || [];
    const inquiries = profile.recentInquiries || [];

    app.innerHTML = `
      ${renderMemberOverview(profile)}
      ${renderCurrentWork(reservations, vehicles)}
      ${renderVehicleMaintenance(vehicles, reservations)}
      ${renderMaintenanceHistory(vehicles, reservations, inquiries)}
      ${renderQuickMessages(profile)}
      ${renderPrimaryActions()}
    `;
  };

  buildDemoProfile = function() {
    const profile = originalBuildDemoProfile();
    const today = new Date();
    const ymd = date => date.toISOString().slice(0, 10);

    profile.recentReservations = [
      {
        id: "demo_reservation_current",
        vehicle_id: "demo_vehicle_1",
        reservation_date: ymd(addDays(today, -1)),
        reservation_time: "10:00",
        work_type: "車検・点検",
        status: "作業中",
        estimated_amount: 132000,
        memo: [
          "【受付経路：LINE】",
          "【進捗：点検中】",
          "代車希望あり"
        ].join("\n")
      },
      {
        id: "demo_reservation_completed_1",
        vehicle_id: "demo_vehicle_1",
        reservation_date: ymd(addDays(today, -36)),
        completed_date: ymd(addDays(today, -35)),
        reservation_time: "09:30",
        work_type: "エンジンオイル交換",
        status: "作業完了",
        actual_sales_amount: 6800,
        completion_memo: "エンジンオイルとオイルフィルターを交換しました。",
        next_oil_change_date: ymd(addDays(today, 145)),
        next_proposal_memo: "次回はタイヤ空気圧も確認",
        memo: [
          "【受付経路：電話】",
          "【進捗：引渡し完了】"
        ].join("\n")
      },
      {
        id: "demo_reservation_completed_2",
        vehicle_id: "demo_vehicle_2",
        reservation_date: ymd(addDays(today, -72)),
        completed_date: ymd(addDays(today, -72)),
        reservation_time: "14:00",
        work_type: "法定点検",
        status: "作業完了",
        actual_sales_amount: 19800,
        completion_memo: "法定点検とバッテリー確認を実施しました。",
        next_shaken_year: addDays(today, 365).getFullYear(),
        next_shaken_month: addDays(today, 365).getMonth() + 1,
        next_proposal_memo: "半年後にオイル交換確認",
        memo: [
          "【受付経路：店頭】",
          "【進捗：引渡し完了】"
        ].join("\n")
      }
    ];

    profile.recentInquiries = (profile.recentInquiries || []).filter(
      inquiry => !String(inquiry.message || "").includes("【見積回答】")
    );

    return profile;
  };

  window.KSH_NEXT_7_MEMBER_HISTORY = {
    inferProgressStage,
    isCurrentReservation,
    isCompletedReservation,
    reservationsForVehicle,
    stripMemberMetadata
  };
})();
