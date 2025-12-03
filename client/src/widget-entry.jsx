import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";  // This gets bundled to widget.css

function getBotIdFromScript() {
  const script = document.currentScript;
  if (!script) return "pizza-bot";

  const attrId = script.getAttribute("data-bot-id");
  if (attrId) return attrId;

  try {
    const src = script.src;
    const url = new URL(src);
    const qp = url.searchParams.get("botId");
    if (qp) return qp;
  } catch (_) {}

  return "pizza-bot";
}

function injectCSS() {
  // Only inject once
  if (document.getElementById('bot-widget-css')) return;
  
  const link = document.createElement('link');
  link.id = 'bot-widget-css';
  link.rel = 'stylesheet';
  link.href = '/widget.css';  // Relative to widget.js location
  
  // Fallback: try to find CSS via script src base
  const scriptSrc = document.currentScript?.src;
  if (scriptSrc) {
    try {
      const baseUrl = new URL(scriptSrc).origin;
      link.href = `${baseUrl}/widget.css`;
    } catch(e) {}
  }
  
  document.head.appendChild(link);
  console.log('🎨 Widget CSS injected');
}

function mountWidget() {
  injectCSS();  // Add this line
  
  let container = document.getElementById("bot-widget-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "bot-widget-container";
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.right = "20px";
    container.style.zIndex = "9999";
    document.body.appendChild(container);
  }

  const botId = getBotIdFromScript();
  console.log("🟢 Mounting widget with botId:", botId);

  const wsPath = "ws://localhost:3001";
  const root = createRoot(container);
  root.render(<App botId={botId} wsPath={wsPath} />);
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", mountWidget);
} else {
mountWidget();
}