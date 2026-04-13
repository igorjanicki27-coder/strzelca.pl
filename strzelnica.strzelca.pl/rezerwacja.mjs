import {
  api,
  createOptionList,
  formatDateTime,
  formatMoney,
  mountHotPayForm,
  readFormJson,
  requireCurrentUser,
  showNotice,
} from "./shooting-range-client.mjs";

let publicData = null;
let selectedSlots = [];
let slotType = "lane";
let currentAccountRole = "user";

function byId(id) {
  return document.getElementById(id);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function renderSummary() {
  const laneId = byId("reservation-lane").value;
  const packageId = byId("reservation-package").value;
  const lane = (publicData?.lanes || []).find((item) => item.id === laneId);
  const packageRow = (publicData?.packages || []).find((item) => item.id === packageId);
  const startsAt = byId("reservation-start").value;
  const endsAt = byId("reservation-end").value;
  const startDate = startsAt ? new Date(startsAt) : null;
  const endDate = endsAt ? new Date(endsAt) : null;
  const hours = startDate && endDate ? Math.max(1, (endDate.getTime() - startDate.getTime()) / (60 * 60 * 1000)) : 1;
  const isCompany = currentAccountRole === "company";
  let price = lane ? Number((isCompany ? lane.companyPricePerHour : lane.pricePerHour) || 0) * hours : 0;
  if (slotType === "training" && packageRow) {
    price = Number((isCompany ? packageRow.companyPrice : packageRow.price) || 0);
  }
  byId("summary-range").textContent = lane ? lane.name : "Wybierz oś";
  byId("summary-slot").textContent = startDate && endDate ? `${formatDateTime(startDate)} - ${formatDateTime(endDate)}` : "Wybierz termin";
  byId("summary-price").textContent = slotType === "training" ? "Płatność na miejscu" : formatMoney(price);
}

function populateSelectors() {
  byId("reservation-lane").innerHTML = `<option value="">Wybierz oś</option>${createOptionList(publicData?.lanes || [], "name")}`;
  byId("reservation-package").innerHTML = `<option value="">Bez pakietu</option>${createOptionList(publicData?.packages || [], "title")}`;
  byId("voucher-token-count").value = "100";
  renderReservations([]);
  renderVouchers([]);
}

function renderSlots(slots) {
  const container = byId("availability-grid");
  container.innerHTML = slots.length
    ? slots
        .map((slot) => `
          <button type="button" class="slot-chip ${slot.available ? "" : "is-disabled"}" data-start="${slot.startsAt}" data-end="${slot.endsAt}" ${slot.available ? "" : "disabled"}>
            <span>${formatDateTime(slot.startsAt).slice(11)}</span>
            <small>${slot.available ? "wolne" : "zajęte"}</small>
          </button>
        `)
        .join("")
    : '<div class="empty-box">Brak slotów dla wybranej osi i daty.</div>';

  container.querySelectorAll(".slot-chip").forEach((button) => {
    button.addEventListener("click", () => {
      container.querySelectorAll(".slot-chip").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      byId("reservation-start").value = button.dataset.start;
      byId("reservation-end").value = button.dataset.end;
      renderSummary();
      maybeLoadInstructors();
    });
  });
}

async function loadAvailability() {
  const laneId = byId("reservation-lane").value;
  const date = byId("reservation-date").value;
  if (!laneId || !date) {
    renderSlots([]);
    return;
  }
  try {
    const data = await api(`availability?laneId=${encodeURIComponent(laneId)}&date=${encodeURIComponent(date)}&type=${encodeURIComponent(slotType)}`, { auth: false });
    selectedSlots = data.slots || [];
    renderSlots(selectedSlots);
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function maybeLoadInstructors() {
  if (slotType !== "training") {
    byId("instructor-wrap").classList.add("hidden");
    return;
  }
  const startsAt = byId("reservation-start").value;
  const currentSlot = selectedSlots.find((slot) => slot.startsAt === startsAt);
  byId("instructor-wrap").classList.remove("hidden");
  const select = byId("reservation-instructor");
  const instructors = currentSlot?.instructors || [];
  select.innerHTML = `<option value="">Wybierz instruktora</option>${instructors
    .map((item) => `<option value="${item.id}">${item.displayName}</option>`)
    .join("")}`;
}

function renderReservations(reservations = []) {
  const list = byId("my-reservations-list");
  list.innerHTML = reservations.length
    ? reservations
        .map(
          (reservation) => `
            <article class="reservation-card">
              <div>
                <strong>${reservation.reservationNumber}</strong>
                <div>${reservation.laneName}${reservation.instructorName ? ` • ${reservation.instructorName}` : ""}</div>
                <small>${formatDateTime(reservation.startsAt)} - ${formatDateTime(reservation.endsAt)}</small>
              </div>
              <div class="reservation-card-side">
                <span class="status-pill status-${reservation.status}">${reservation.status.replace(/_/g, " ")}</span>
                <span>${reservation.paymentMethod === "on_site" ? "na miejscu" : reservation.paymentMethod === "tokens" ? `${reservation.tokenCost} żetonów` : formatMoney(reservation.totalPrice)}</span>
                ${reservation.status !== "anulowana" ? `<button type="button" class="ghost-btn cancel-reservation-btn" data-id="${reservation.id}">Anuluj</button>` : ""}
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-box">Nie masz jeszcze żadnych rezerwacji strzeleckich.</div>';

  list.querySelectorAll(".cancel-reservation-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("reservation/cancel", {
          method: "POST",
          body: { reservationId: button.dataset.id },
        });
        showNotice("Rezerwacja została anulowana.", "success");
        await refreshPrivateData();
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
  });
}

function renderVouchers(vouchers = []) {
  const list = byId("voucher-list");
  list.innerHTML = vouchers.length
    ? vouchers
        .map(
          (voucher) => `
            <article class="voucher-card">
              <div>
                <strong>${voucher.tokens} żetonów</strong>
                <div>${voucher.code}</div>
                <small>Status: ${voucher.status}</small>
              </div>
              <div class="voucher-card-side">
                ${voucher.pdfBase64 ? `<a class="ghost-btn" href="data:application/pdf;base64,${voucher.pdfBase64}" download="${voucher.pdfFileName || "voucher.pdf"}">Pobierz PDF</a>` : ""}
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-box">Nie masz jeszcze żadnych voucherów.</div>';
}

async function refreshPrivateData() {
  try {
    const [reservationsData, vouchersData] = await Promise.all([
      api("reservation/list"),
      api("voucher/list"),
    ]);
    renderReservations(reservationsData.reservations || []);
    renderVouchers(vouchersData.vouchers || []);
  } catch (error) {
    console.warn(error);
  }
}

function bindEvents() {
  byId("reservation-date").value = todayIso();
  byId("reservation-type").addEventListener("change", async (event) => {
    slotType = event.target.value === "training" ? "training" : "lane";
    byId("package-wrap").classList.toggle("hidden", slotType !== "training");
    byId("lane-declarations").classList.toggle("hidden", slotType !== "lane");
    byId("payment-method").innerHTML =
      slotType === "training"
        ? '<option value="on_site">Płatność na miejscu</option>'
        : '<option value="hotpay">HotPay</option><option value="tokens">Żetony</option>';
    await loadAvailability();
    renderSummary();
  });

  ["reservation-lane", "reservation-date"].forEach((id) => {
    byId(id).addEventListener("change", loadAvailability);
  });
  ["reservation-package", "payment-method"].forEach((id) => {
    byId(id).addEventListener("change", renderSummary);
  });

  byId("reservation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await requireCurrentUser();
      const form = readFormJson(event.currentTarget);
      const reservation = await api("reservation/create", {
        method: "POST",
        body: {
          type: slotType,
          laneId: form.laneId,
          packageId: form.packageId || "",
          instructorId: form.instructorId || "",
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          paymentMethod: form.paymentMethod,
          personsCount: 1,
          notes: form.notes || "",
          policyAccepted: form.policyAccepted === "on",
          declarations: {
            isAdult: form.isAdult === "on",
            hasRangeOfficerPermission: form.hasRangeOfficerPermission === "on",
          },
        },
      });
      showNotice("Rezerwacja została zapisana.", "success");
      if (reservation.reservation?.hotpay) {
        mountHotPayForm(byId("hotpay-form-mount"), reservation.reservation.hotpay);
        return;
      }
      await refreshPrivateData();
    } catch (error) {
      if (error.message !== "redirecting-to-login") showNotice(error.message, "error");
    }
  });

  byId("voucher-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await requireCurrentUser();
      const form = readFormJson(event.currentTarget);
      const data = await api("voucher/purchase", {
        method: "POST",
        body: {
          tokens: Number(form.tokens || 100),
          recipientName: form.recipientName || "",
          message: form.message || "",
        },
      });
      showNotice("Voucher został przygotowany. Przekierowuję do płatności HotPay.", "success");
      mountHotPayForm(byId("hotpay-form-mount"), data.voucher?.hotpay);
    } catch (error) {
      if (error.message !== "redirecting-to-login") showNotice(error.message, "error");
    }
  });

  byId("voucher-redeem-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await requireCurrentUser();
      const form = readFormJson(event.currentTarget);
      await api("voucher/redeem", {
        method: "POST",
        body: { code: form.code || "" },
      });
      showNotice("Voucher został zrealizowany, a żetony dopisane do Twojego konta.", "success");
      event.currentTarget.reset();
      await refreshPrivateData();
    } catch (error) {
      if (error.message !== "redirecting-to-login") showNotice(error.message, "error");
    }
  });
}

async function init() {
  try {
    publicData = await api("public", { auth: false });
    populateSelectors();
    bindEvents();
    renderSummary();
    try {
      await requireCurrentUser();
      const meResponse = await fetch("https://strzelca.pl/api/me", {
        credentials: "include",
        cache: "no-store",
      });
      const meData = await meResponse.json().catch(() => null);
      currentAccountRole = String(meData?.role || "user").toLowerCase();
      renderSummary();
      await refreshPrivateData();
    } catch (_) {
      // Widok rezerwacji prywatnych zostanie wypełniony po logowaniu.
    }
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Nie udało się uruchomić rezerwacji.", "error");
  }
}

init();
