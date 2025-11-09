"use strict";

const state = {
  defaults: null,
  tasks: [],
  selectedTaskId: null,
  refreshTimer: null,
};

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (resp.status === 204) return null;
  const data = await resp.json();
  if (!resp.ok) {
    const message = data?.detail || "Request failed";
    throw new Error(message);
  }
  return data;
}

function setStatus(text, variant = "") {
  const el = document.getElementById("api-status");
  el.textContent = text;
  el.className = `status-pill ${variant}`;
}

async function loadDefaults() {
  try {
    const defaults = await api("/api/config/defaults");
    state.defaults = defaults;

    const form = document.getElementById("create-task-form");
    form.max_steps.value = defaults.max_steps;
    form.leave_browser_open.checked = defaults.leaveBrowserOpen;

    const modelSelect = document.getElementById("model-select");
    modelSelect.innerHTML = "";
    defaults.supportedModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
    modelSelect.value = defaults.model;

    const reasoningSelect = document.getElementById("reasoning-select");
    reasoningSelect.innerHTML = '<option value="">Automatic</option>';
    (defaults.reasoningEffortOptions || []).forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      reasoningSelect.appendChild(option);
    });
    reasoningSelect.value = "";
    setStatus("Ready", "success");
  } catch (err) {
    console.error(err);
    setStatus(err.message, "danger");
  }
}

async function refreshTasks() {
  try {
    const summaries = await api("/api/tasks");
    state.tasks = summaries;
    renderTasks();
    if (state.selectedTaskId) {
      await loadTaskDetail(state.selectedTaskId);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message, "danger");
  }
}

function renderTasks() {
  const container = document.getElementById("tasks-container");
  if (!state.tasks.length) {
    container.innerHTML = `<p class="muted">No tasks yet.</p>`;
    return;
  }

  container.innerHTML = "";
  state.tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "task-card";

    const statusClass =
      task.status === "completed"
        ? "success"
        : task.status === "failed"
        ? "danger"
        : task.needs_attention
        ? "warn"
        : "";

    const browserTag = task.browser_open
      ? `<span class="status-pill success">Browser open</span>`
      : "";
    const attentionTag = task.needs_attention
      ? `<span class="status-pill warn">Needs input</span>`
      : "";

    card.innerHTML = `
      <div>
        <h3>${task.title}</h3>
        <div class="meta">
          <span class="status-pill ${statusClass}">${task.status}</span>
          ${browserTag}
          ${attentionTag}
          <span>Steps: ${task.step_count}</span>
          <span>Model: ${task.model_name}</span>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="view">View</button>
        <button type="button" class="secondary dangerous" data-action="delete">Remove</button>
      </div>
    `;

    card.querySelector('[data-action="view"]').addEventListener("click", () => {
      state.selectedTaskId = task.id;
      loadTaskDetail(task.id);
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete task "${task.title}"?`)) {
        return;
      }
      try {
        await api(`/api/tasks/${task.id}`, { method: "DELETE" });
        if (state.selectedTaskId === task.id) {
          state.selectedTaskId = null;
          clearDetail();
        }
        await refreshTasks();
      } catch (err) {
        alert(err.message);
      }
    });

    container.appendChild(card);
  });
}

async function loadTaskDetail(taskId) {
  try {
    const detail = await api(`/api/tasks/${taskId}`);
    renderDetail(detail);
  } catch (err) {
    console.error(err);
    if (state.selectedTaskId === taskId) {
      clearDetail();
    }
  }
}

function clearDetail() {
  document.getElementById("detail-status").textContent = "None selected";
  document.getElementById("detail-status").className = "status-pill muted";
  document.getElementById("detail-content").innerHTML =
    '<p class="muted">Select a task to inspect progress.</p>';
}

function renderDetail(detail) {
  const { record, steps, chat_history, vnc_launch_url } = detail;
  const statusEl = document.getElementById("detail-status");
  statusEl.textContent = record.status;
  statusEl.className = `status-pill ${
    record.status === "completed"
      ? "success"
      : record.status === "failed"
      ? "danger"
      : record.needs_attention
      ? "warn"
      : ""
  }`;

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
        <h3>Chat History</h3>
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
        await api(`/api/tasks/${record.id}/assist`, {
          method: "POST",
          body: JSON.stringify({ message: text }),
        });
        assistForm.reset();
        await refreshTasks();
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
        !confirm(
          "Closing the browser will discard the preserved session. Continue?"
        )
      ) {
        return;
      }
      await api(`/api/tasks/${record.id}/close-browser`, { method: "POST" });
      await refreshTasks();
    });
  }

  const openBrowserBtn = content.querySelector('[data-action="open-browser"]');
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", async () => {
      await api(`/api/tasks/${record.id}/open-browser`, { method: "POST" });
      await refreshTasks();
    });
  }
}

async function handleCreateTask(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    title: form.title.value.trim(),
    instructions: form.instructions.value.trim(),
    model: form.model.value,
    max_steps: Number(form.max_steps.value),
    leave_browser_open: form.leave_browser_open.checked,
  };
  const reasoningEffort = form.reasoning_effort.value;
  if (reasoningEffort) {
    payload.reasoning_effort = reasoningEffort;
  }

  if (!payload.title || !payload.instructions) {
    alert("Title and instructions are required.");
    return;
  }

  try {
    const detail = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    form.model.value = state.defaults?.model || payload.model;
    form.reasoning_effort.value = "";
    state.selectedTaskId = detail.record.id;
    await refreshTasks();
  } catch (err) {
    alert(err.message);
  }
}

function init() {
  const refreshSeconds = Number(document.body.dataset.refresh || "3");
  document
    .getElementById("create-task-form")
    .addEventListener("submit", handleCreateTask);
  document
    .getElementById("refresh-btn")
    .addEventListener("click", refreshTasks);

  loadDefaults().then(refreshTasks);
  state.refreshTimer = setInterval(refreshTasks, refreshSeconds * 1000);
}

document.addEventListener("DOMContentLoaded", init);
