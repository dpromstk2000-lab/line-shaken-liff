(() => {
  "use strict";

  let nextFollowupTimingFilter = "urgent";
  let nextFollowupSort = "due";

  const originalRenderFollowupSummary = renderFollowupSummary;

  function candidateDays(row) {
    if (row?.days_until !== null && row?.days_until !== undefined && row?.days_until !== "") {
      const n = Number(row.days_until);
      return Number.isFinite(n) ? n : null;
    }

    const due = normalizeDateInput(row?.due_date || "");
    if (!due) return null;

    const today = new Date(`${dateYmd(new Date())}T00:00:00`);
    const target = new Date(`${due}T00:00:00`);
    const days = Math.round((target.getTime() - today.getTime()) / 86400000);
    return Number.isFinite(days) ? days : null;
  }

  function candidateTiming(row) {
    const days = candidateDays(row);
    if (days === null) return "no_date";
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days <= 7) return "week";
    if (days <= 30) return "month";
    return "later";
  }

  function timingMatches(row, filter) {
    const days = candidateDays(row);

    if (filter === "all") return true;
    if (filter === "no_date") return days === null;
    if (filter === "urgent") return days !== null && days <= 7;
    if (filter === "overdue") return days !== null && days < 0;
    if (filter === "today") return days === 0;
    if (filter === "week") return days !== null && days >= 0 && days <= 7;
    if (filter === "month") return days !== null && days >= 0 && days <= 30;
    return true;
  }

  function priorityWeight(row) {
    const priority = String(row?.priority || "").toLowerCase();
    if (["urgent", "high", "緊急", "高"].includes(priority)) return 0;
    if (["medium", "normal", "中", "通常"].includes(priority)) return 1;
    return 2;
  }

  function typeWeight(row) {
    return {
      shaken: 0,
      estimate: 1,
      oil: 2,
      proposal: 3,
      line_unlinked: 4
    }[row?.type] ?? 9;
  }

  function sortedCandidates(rows) {
    return rows.slice().sort((a, b) => {
      if (Boolean(a?.is_handled) !== Boolean(b?.is_handled)) {
        return a?.is_handled ? 1 : -1;
      }

      if (nextFollowupSort === "priority") {
        const byPriority = priorityWeight(a) - priorityWeight(b);
        if (byPriority) return byPriority;
      }

      if (nextFollowupSort === "type") {
        const byType = typeWeight(a) - typeWeight(b);
        if (byType) return byType;
      }

      if (nextFollowupSort === "name") {
        return String(a?.customer_name || "").localeCompare(String(b?.customer_name || ""), "ja");
      }

      const aDays = candidateDays(a);
      const bDays = candidateDays(b);
      if (aDays === null && bDays !== null) return 1;
      if (aDays !== null && bDays === null) return -1;
      if (aDays !== bDays) return Number(aDays || 0) - Number(bDays || 0);

      const byPriority = priorityWeight(a) - priorityWeight(b);
      if (byPriority) return byPriority;
      return typeWeight(a) - typeWeight(b);
    });
  }

  function fallbackMessage(row) {
    const name = row?.customer_name || "お客様";
    const shop = getShopName();
    const vehicle = buildFollowupVehicleText(row);
    const due = row?.due_date ? formatDate(row.due_date) : "";
    const proposal = row?.proposal_memo || row?.reason || "";

    if (row?.type === "shaken") {
      return `${name}様
いつも${shop}をご利用いただきありがとうございます。
${vehicle}の車検時期が${due ? `${due}頃に` : ""}近づいております。
ご希望の日程がございましたら、早めのご相談がおすすめです。`;
    }

    if (row?.type === "oil") {
      return `${name}様
${shop}です。
${vehicle}のオイル交換時期が近づいております。
お車の状態確認もあわせて、お気軽にご相談ください。`;
    }

    if (row?.type === "estimate") {
      return `${name}様
${shop}です。
先日ご案内したお見積内容について、その後いかがでしょうか。
ご不明点や変更希望がございましたら、お気軽にご返信ください。`;
    }

    if (row?.type === "proposal") {
      return `${name}様
${shop}です。
${vehicle}について、${proposal || "次回点検・メンテナンス"}のご案内です。
ご都合のよい時期がございましたら、お気軽にご相談ください。`;
    }

    return `${name}様
${shop}です。
お車の点検・整備について、LINEからいつでもご相談いただけます。
気になることがございましたら、お気軽にご連絡ください。`;
  }

  function ensureCandidateMessage(row) {
    if (!row) return "";
    const current = String(row.edited_message_text || row.message_text || "").trim();
    if (current) return current;
    const fallback = fallbackMessage(row);
    row.edited_message_text = fallback;
    return fallback;
  }

  function timingLabel(row) {
    const days = candidateDays(row);
    if (days === null) return "日付未設定";
    if (days < 0) return `${Math.abs(days)}日超過`;
    if (days === 0) return "本日";
    return `あと${days}日`;
  }

  function timingClass(row) {
    return candidateTiming(row);
  }

  function updateTimingButtons() {
    document.querySelectorAll(".next-followup-timing button").forEach(button => {
      button.classList.remove("active");
    });
    document.getElementById(`nft-${nextFollowupTimingFilter}`)?.classList.add("active");
  }

  function updateSummaryCounts() {
    const rows = Array.isArray(followupCandidatesCache) ? followupCandidatesCache : [];
    const activeRows = rows.filter(row => !row?.is_handled);

    const overdue = activeRows.filter(row => {
      const days = candidateDays(row);
      return days !== null && days < 0;
    }).length;
    const today = activeRows.filter(row => candidateDays(row) === 0).length;
    const week = activeRows.filter(row => {
      const days = candidateDays(row);
      return days !== null && days >= 0 && days <= 7;
    }).length;
    const month = activeRows.filter(row => {
      const days = candidateDays(row);
      return days !== null && days >= 0 && days <= 30;
    }).length;

    setText("nextFollowupOverdueCount", `${overdue}件`);
    setText("nextFollowupTodayCount", `${today}件`);
    setText("nextFollowupWeekCount", `${week}件`);
    setText("nextFollowupMonthCount", `${month}件`);
  }

  renderFollowupSummary = function(summary, generatedAt) {
    originalRenderFollowupSummary(summary, generatedAt);
    updateSummaryCounts();
  };

  setFollowupFilter = function(filter) {
    currentFollowupFilter = filter;

    if (["estimate", "line_unlinked"].includes(filter)) {
      nextFollowupTimingFilter = "all";
    }

    updateFollowupFilterButtons();
    updateTimingButtons();
    renderFollowupCandidates();
  };

  window.setNextFollowupTiming = function(filter) {
    nextFollowupTimingFilter = filter || "all";
    updateTimingButtons();
    renderFollowupCandidates();
  };

  window.setNextFollowupSort = function(value) {
    nextFollowupSort = value || "due";
    const select = document.getElementById("nextFollowupSort");
    if (select && select.value !== nextFollowupSort) select.value = nextFollowupSort;
    renderFollowupCandidates();
  };

  function primaryContactButton(row, index) {
    if (row?.line_user_id) {
      return `<button class="btn btn-dark" onclick="openLineManager()">LINE公式チャット</button>`;
    }
    return `<button class="btn btn-slate" onclick="copyFollowupPhone(${index})">電話番号コピー</button>`;
  }

  function reservationButton(row, index) {
    if (!row?.customer_id) return "";
    if (row?.has_future_reservation) {
      return `<button class="btn btn-slate" type="button" disabled>入庫予定あり</button>`;
    }
    return `<button class="btn btn-green" onclick="openReservationFromFollowup(${index})">入庫予定へ</button>`;
  }

  function renderFollowupCard(row, index) {
    const message = ensureCandidateMessage(row);
    const timing = timingClass(row);
    const handled = row?.is_handled ? " handled" : "";
    const due = row?.due_date ? formatDate(row.due_date) : "未設定";
    const lineStatus = row?.line_user_id
      ? `<span class="badge badge-green">LINE連携済み</span>`
      : `<span class="badge badge-slate">LINE未連携</span>`;
    const futureReservation = row?.has_future_reservation
      ? `<span class="badge badge-green">今後の入庫予定あり</span>`
      : "";
    const handledBadge = row?.is_handled
      ? `<span class="badge badge-green">${escapeHtml(row.handled_label || "対応済み")}</span>`
      : "";

    return `
      <article class="next-followup-card ${timing}${handled}">
        <div class="next-followup-head">
          <div>
            <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
              ${badgeFollowupType(row.type_label || row.type)}
              ${badgeFollowupPriority(row.priority)}
              ${lineStatus}
              ${futureReservation}
              ${handledBadge}
            </div>
            <div class="next-followup-name" style="margin-top:8px">${escapeHtml(row.customer_name || "未入力")} 様</div>
            <div class="next-followup-vehicle">${escapeHtml(buildFollowupVehicleText(row))}</div>
          </div>
          <div class="next-followup-reason-box">
            <strong>今回のフォロー理由</strong>
            ${escapeHtml(row.reason || "フォロー候補")}
            ${row.recommended_action ? `<div style="margin-top:5px;font-weight:900">おすすめ：${escapeHtml(row.recommended_action)}</div>` : ""}
          </div>
          <div class="next-followup-date">
            <strong>${escapeHtml(due)}</strong>
            <span class="${timing}">${escapeHtml(timingLabel(row))}</span>
          </div>
        </div>

        <div class="next-followup-reason">
          <div class="next-followup-reason-box">
            <strong>次回提案・補足</strong>
            ${escapeHtml(row.proposal_memo || "個別文面を確認し、必要に応じて編集してください。")}
          </div>
          <div class="next-followup-reason-box">
            <strong>対応方針</strong>
            ${row?.is_handled
              ? `${escapeHtml(row.handled_label || "対応済み")}として記録されています。`
              : row?.has_future_reservation
                ? "入庫予定があるため、重複案内にならないか確認してください。"
                : "文面確認後、LINEまたは電話で個別に連絡します。"}
          </div>
        </div>

        <div class="next-followup-primary-actions">
          <button class="btn btn-primary" onclick="copyFollowupMessage(${index})">文面確認</button>
          ${primaryContactButton(row, index)}
          ${reservationButton(row, index)}
        </div>

        <details class="next-followup-details">
          <summary><span>文面編集・対応後の記録</span><span>${escapeHtml(row.type_label || row.type || "フォロー")}</span></summary>
          <div class="next-followup-details-body">
            <textarea
              id="followupMessage-${index}"
              class="next-followup-message"
              oninput="updateFollowupMessage(${index})"
            >${escapeHtml(message)}</textarea>
            ${renderCandidateTemplateButtons(row, index)}
            <div class="next-followup-record-actions">
              <button class="btn btn-slate" onclick="resetFollowupMessage(${index})">自動文面に戻す</button>
              <button class="btn btn-green" onclick="markFollowupHandled(${index}, 'line_sent')">チャット送信済み</button>
              <button class="btn btn-slate" onclick="markFollowupHandled(${index}, 'phone_called')">電話済み</button>
              <button class="btn btn-slate" onclick="scheduleFollowupRecontact(${index}, 3)">3日後</button>
              <button class="btn btn-slate" onclick="scheduleFollowupRecontact(${index}, 7)">1週間後</button>
              <button class="btn btn-dark" onclick="scheduleFollowupRecontact(${index}, 30)">1か月後</button>
              <button class="btn btn-dark" onclick="markFollowupHandled(${index}, 'skipped')">今回は見送り</button>
            </div>
          </div>
        </details>
      </article>
    `;
  }

  renderFollowupCandidates = function() {
    updateFollowupFilterButtons();
    updateTimingButtons();
    updateSummaryCounts();

    const allRows = Array.isArray(followupCandidatesCache) ? followupCandidatesCache : [];
    const filtered = allRows.filter(row => {
      const typeMatches = currentFollowupFilter === "all" || row?.type === currentFollowupFilter;
      return typeMatches && timingMatches(row, nextFollowupTimingFilter);
    });

    const rows = sortedCandidates(filtered);
    followupVisibleCache = rows;

    const box = document.getElementById("nextFollowupCockpit");
    const legacyBody = document.getElementById("followupCandidatesTableBody");
    if (legacyBody) legacyBody.innerHTML = "";

    setText(
      "nextFollowupVisibleCount",
      `${rows.length}件表示 / 全${allRows.length}件`
    );

    if (!box) return;

    if (!rows.length) {
      box.innerHTML = `
        <div class="next-followup-empty">
          この条件のフォロー候補はありません。<br>
          「すべて」または別の時期・種別を選択してください。
        </div>
      `;
      return;
    }

    box.innerHTML = rows.map(renderFollowupCard).join("");
  };

  copyFollowupMessage = function(index) {
    const row = followupVisibleCache[index];
    if (!row) return;

    const message = getFollowupMessage(index) || ensureCandidateMessage(row);
    openMessageEditor({
      title: "次回整備・車検フォローのLINE文面",
      source: `${row.customer_name || "お客様"} / ${buildFollowupVehicleText(row)} / ${row.reason || row.type_label || "フォロー"}`,
      text: message,
      options: buildSimpleRewriteOptions(message, row.customer_name || "")
    });
  };

  window.KSH_NEXT_8_FOLLOWUP = {
    candidateDays,
    candidateTiming,
    timingMatches,
    sortedCandidates,
    fallbackMessage
  };
})();
