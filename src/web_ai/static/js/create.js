"use strict";

const formSelectors = {
  form: null,
  modelSelect: null,
  reasoningSelect: null,
  defaultModel: "",
};

async function loadDefaults() {
  try {
    const defaults = await webAI.api("/api/config/defaults");
    const form = formSelectors.form;
    form.max_steps.value = defaults.max_steps;
    form.leave_browser_open.checked = defaults.leaveBrowserOpen;

    const modelSelect = formSelectors.modelSelect;
    modelSelect.innerHTML = "";
    defaults.supportedModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
    modelSelect.value = defaults.model;
    formSelectors.defaultModel = defaults.model;

    const reasoningSelect = formSelectors.reasoningSelect;
    reasoningSelect.innerHTML = '<option value="">Automatic</option>';
    (defaults.reasoningEffortOptions || []).forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      reasoningSelect.appendChild(option);
    });

    webAI.setStatus("Ready", "success");
  } catch (err) {
    console.error(err);
    webAI.setStatus(err.message, "danger");
  }
}

async function handleCreate(event) {
  event.preventDefault();
  const form = formSelectors.form;
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
    const detail = await webAI.api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    form.model.value = formSelectors.defaultModel;
    form.reasoning_effort.value = "";
    webAI.setStatus("Task launched", "success");
    window.location.href = `/tasks/${detail.record.id}`;
  } catch (err) {
    alert(err.message);
    webAI.setStatus(err.message, "danger");
  }
}

function initCreate() {
  formSelectors.form = document.getElementById("create-task-form");
  formSelectors.modelSelect = document.getElementById("model-select");
  formSelectors.reasoningSelect = document.getElementById("reasoning-select");

  formSelectors.form.addEventListener("submit", handleCreate);
  loadDefaults();
}

document.addEventListener("DOMContentLoaded", initCreate);
