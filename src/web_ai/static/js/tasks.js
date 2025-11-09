"use strict";

const tasksState = {
  refreshTimer: null,
};

function getStatusClass(task) {
  if (task.status === "completed") {
    return "success";
  }
  if (task.status === "failed") {
    return "danger";
  }
  if (task.needs_attention) {
    return "warn";
  }
  return "";
}

function renderTasks(tasks) {
  const container = document.getElementById("tasks-container");
  if (!tasks.length) {
    container.innerHTML = `
      <div class="task-card">
        <p class="muted">No tasks yet. Launch one to see it here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "tasks-grid";

  tasks.forEach((task) => {
    const card = document.createElement("article");
    card.className = "task-card";

    const statusClass = getStatusClass(task);
    const browserTag = task.browser_open
      ? '<span class="status-pill success">Browser open</span>'
      : "";
    const attentionTag = task.needs_attention
      ? '<span class="status-pill warn">Needs input</span>'
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
      window.location.href = `/tasks/${task.id}`;
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete task "${task.title}"?`)) {
        return;
      }
      try {
        await webAI.api(`/api/tasks/${task.id}`, { method: "DELETE" });
        await loadTasks();
      } catch (err) {
        alert(err.message);
      }
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

async function loadTasks() {
  try {
    const summaries = await webAI.api("/api/tasks");
    renderTasks(summaries);
    webAI.setStatus("Ready", "success");
  } catch (err) {
    webAI.setStatus(err.message, "danger");
  }
}

function initTasks() {
  document.getElementById("refresh-btn").addEventListener("click", loadTasks);

  const refreshSeconds = Number(document.body.dataset.refresh || "5");
  if (refreshSeconds > 0) {
    tasksState.refreshTimer = setInterval(loadTasks, refreshSeconds * 1000);
  }

  loadTasks();
}

document.addEventListener("DOMContentLoaded", initTasks);
