"use strict";

const detailState = {
  refreshTimer: null,
  taskId: null,
};

function formatStatusClass(record) {
  if (record.status === "completed") {
    return "success";
  }
  if (record.status === "failed") {
    return "danger";
  }
  if (record.needs_attention) {
    return "warn";
  }
  return "";
}

function clearDetail() {
  const statusEl = document.getElementById("detail-status");
  const contentEl = document.getElementById("detail-content");
  if (statusEl) {
    statusEl.textContent = "No data";
    statusEl.className = "status-pill muted";
  }
  if (contentEl) {
    contentEl.innerHTML = '<p class="muted">Unable to load task detail.</p>';
  }
}

function renderDetail(detail) {
  const { record, steps, chat_history, vnc_launch_url } = detail;
  const statusEl = document.getElementById("detail-status");
  statusEl.textContent = record.status;
  statusEl.className = `status-pill ${formatStatusClass(record)}`;

  const content = document.getElementById("detail-content");
  const actions = [];
  if (vnc_launch_url) {
    actions.push(
      `<button type="button" data-action="open-vnc" ${
        record.browser_open ? "" : "disabled"
      }>Open VNC</button>`
    );
  }
  if (record.browser_open) {
    actions.push(
      `<button type="button" data-action="close-browser" class="secondary dangerous">Close browser</button>`
    );
  } else {
    actions.push(
      `<button type="button" data-action="open-browser" class="secondary">Open browser</button>`
    );
  }

  const html = `
    <div class="detail-grid">
      <div class="section">
        <h3>${record.title}</h3>
        <p><strong>Instructions:</strong></p>
        <p class="muted">${record.instructions}</p>
        <p class="muted">Model: ${record.model_name} · Reasoning: ${
          record.reasoning_effort || "auto"
        }</p>
        <p class="muted">Steps executed: ${record.step_count} / ${record.max_steps}</p>
        ${
          record.last_error
            ? `<p class="status-pill danger">Error: ${record.last_error}</p>`
            : ""
        }
        ${actions.length ? `<div class="actions-row">${actions.join("")}</div>` : ""}
      </div>

      <div class="section">
        <h3>Chat history</h3>
        <div class="steps-list">
          ${chat_history
            .map(
              (msg) => `
            <div class="step-card">
              <strong>${msg.role}</strong>
              <p>${msg.content}</p>
            </div>
          `
            )
            .join("")}
        </div>
      </div>

      <div class="section">
        <h3>Progress</h3>
        <div class="steps-list">
          ${
            steps.length
              ? steps
                  .map(
                    (step) => `
              <div class="step-card">
                <strong>Step ${step.step_number}</strong>
                <div>${step.summary_html || ""}</div>
                ${
                  step.screenshot_b64
                    ? `<img src="data:image/jpeg;base64,${step.screenshot_b64}" alt="Step ${step.step_number} screenshot" />`
                    : ""
                }
              </div>
            `
                  )
                  .join("")
              : '<p class="muted">Waiting for first step…</p>'
          }
        </div>
      </div>

      ${
        record.needs_attention
          ? `
          <div class="section">
            <h3>Assistance requested</h3>
            <p>${record.assistance?.question || "Agent waiting for guidance."}</p>
            <form class="assist-form" data-task="${record.id}">
              <textarea name="assist" placeholder="Type your response"></textarea>
              <button type="submit">Send response</button>
            </form>
          </div>
        `
          : ""
      }
    </div>
  `;
  content.innerHTML = html;

  if (record.needs_attention) {
    const assistForm = content.querySelector(".assist-form");
    assistForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const text = assistForm.assist.value.trim();
      if (!text) {
        alert("Response cannot be empty.");
        return;
      }
      try {
        await webAI.api(`/api/tasks/${record.id}/assist`, {
          method: "POST",
          body: JSON.stringify({ message: text }),
        });
        assistForm.reset();
        await loadDetail();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const openVncBtn = content.querySelector('[data-action="open-vnc"]');
  if (openVncBtn && record.browser_open && vnc_launch_url) {
    openVncBtn.addEventListener("click", () => {
      window.open(vnc_launch_url, "_blank");
    });
  }

  const closeBrowserBtn = content.querySelector('[data-action="close-browser"]');
  if (closeBrowserBtn) {
    closeBrowserBtn.addEventListener("click", async () => {
      if (
        !confirm("Closing the browser will discard the preserved session. Continue?")
      ) {
        return;
      }
      await webAI.api(`/api/tasks/${record.id}/close-browser`, { method: "POST" });
      await loadDetail();
    });
  }

  const openBrowserBtn = content.querySelector('[data-action="open-browser"]');
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", async () => {
      await webAI.api(`/api/tasks/${record.id}/open-browser`, { method: "POST" });
      await loadDetail();
    });
  }
}

async function loadDetail() {
  const { taskId } = detailState;
  if (!taskId) {
    return;
  }
  try {
    const detail = await webAI.api(`/api/tasks/${taskId}`);
    renderDetail(detail);
    webAI.setStatus("Detail updated", "success");
  } catch (err) {
    console.error(err);
    webAI.setStatus(err.message, "danger");
    clearDetail();
  }
}

function initDetail() {
  const panel = document.querySelector(".detail-panel");
  detailState.taskId = panel?.dataset.taskId;
  if (!detailState.taskId) {
    clearDetail();
    return;
  }

  loadDetail();
  const refreshSeconds = Number(document.body.dataset.refresh || "5");
  if (refreshSeconds > 0) {
    detailState.refreshTimer = setInterval(loadDetail, refreshSeconds * 1000);
  }
}

document.addEventListener("DOMContentLoaded", initDetail);
