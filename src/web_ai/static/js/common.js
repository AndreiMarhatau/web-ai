"use strict";

window.webAI = {
  async api(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (response.status === 204) {
      return null;
    }
    const data = await response.json();
    if (!response.ok) {
      const message = data?.detail || "Request failed";
      throw new Error(message);
    }
    return data;
  },
  setStatus(text, variant = "") {
    const status = document.getElementById("api-status");
    if (!status) {
      return;
    }
    status.textContent = text;
    status.className = `status-pill ${variant}`;
  },
};
