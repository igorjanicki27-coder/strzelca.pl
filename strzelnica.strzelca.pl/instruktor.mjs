import {
  api,
  formatDateTime,
  readFormJson,
  requireCurrentUser,
  showNotice,
} from "./shooting-range-client.mjs";

function byId(id) {
  return document.getElementById(id);
}

function renderSummary(data) {
  byId("instructor-list").innerHTML = (data.instructors || []).length
    ? data.instructors
        .map(
          (item) => `
            <article class="instruktor-card">
              <div>
                <strong>${item.displayName}</strong>
                <p>${(item.bio || "").replace(/<[^>]+>/g, "").slice(0, 180)}</p>
              </div>
              <div class="tag-list">
                ${(item.specialties || []).map((entry) => `<span>${entry}</span>`).join("")}
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-box">Brak aktywnych instruktorów.</div>';

  byId("availability-list").innerHTML = (data.availability || []).length
    ? data.availability
        .map(
          (item) => `
            <article class="simple-list-card">
              <strong>${formatDateTime(item.startsAt)} - ${formatDateTime(item.endsAt)}</strong>
              <span>${item.status}</span>
              <small>${item.note || ""}</small>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-box">Brak ustawionej dyspozycyjności.</div>';

  byId("reservation-list").innerHTML = (data.reservations || []).length
    ? data.reservations
        .map(
          (item) => `
            <article class="simple-list-card">
              <strong>${item.reservationNumber}</strong>
              <span>${item.laneName}</span>
              <small>${formatDateTime(item.startsAt)} - ${formatDateTime(item.endsAt)}</small>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-box">Brak przypisanych rezerwacji.</div>';
}

async function refresh() {
  const data = await api("instruktor/summary");
  renderSummary(data);
}

async function init() {
  try {
    await requireCurrentUser();
    await refresh();
    byId("availability-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const form = readFormJson(event.currentTarget);
        await api("instruktor/availability/save", {
          method: "POST",
          body: {
            instructorId: form.instructorId || "",
            startsAt: form.startsAt,
            endsAt: form.endsAt,
            status: form.status,
            note: form.note || "",
          },
        });
        showNotice("Dyspozycyjność została zapisana.", "success");
        event.currentTarget.reset();
        await refresh();
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
  } catch (error) {
    if (error.message !== "redirecting-to-login") {
      showNotice(error.message || "Brak dostępu do panelu instruktora.", "error");
    }
  }
}

init();
