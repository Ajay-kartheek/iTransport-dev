import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

import { MotionGlobalConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { registerServiceWorker } from "./lib/push";

// Development aid for screenshots and automated checks: /?motion=off
if (import.meta.env.DEV && new URLSearchParams(location.search).get("motion") === "off") {
  MotionGlobalConfig.skipAnimations = true;
}

// After a deploy, an open tab may ask for a screen bundle that no longer exists.
// Reload once to pick up the new version instead of showing a broken page.
window.addEventListener("vite:preloadError", (event) => {
  const key = "itransport.reloadedForUpdate";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  event.preventDefault();
  window.location.reload();
});

void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
