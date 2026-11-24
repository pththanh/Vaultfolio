"use client";

import { useEffect } from "react";

/**
 * Registers the service worker and publishes the visible area as CSS variables,
 * so dialogs stay above the on-screen keyboard (iOS does not resize the page).
 */
export function AppRuntime() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const update = () => {
      // Pinch zoom also shrinks the visual viewport; that is not a keyboard.
      if (vv.scale > 1.05) return;
      const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.setProperty("--vv-height", `${vv.height}px`);
      root.setProperty("--vv-top", `${vv.offsetTop}px`);
      root.setProperty("--vv-bottom", `${bottom}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return null;
}
