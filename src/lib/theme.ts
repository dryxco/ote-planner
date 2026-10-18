"use client";

import { useSyncExternalStore } from "react";

/** Appearance is per device (not synced): "system" follows the OS light/dark setting. */
export type ThemePref = "system" | "dark" | "light";
export const THEME_KEY = "sync-theme";

/** The browser tab's icon follows the theme too, in a link of its own (React owns the metadata ones). A home-screen icon is fixed when it's added. */
const DARK_ICON = "/icons/icon-192.png";
const LIGHT_ICON = "/icons/icon-light-192.png";

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var k="${THEME_KEY}",m=matchMedia("(prefers-color-scheme: light)");function a(){var p=localStorage.getItem(k)||"system";var t=p==="system"?(m.matches?"light":"dark"):p;document.documentElement.dataset.theme=t;var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",t==="light"?"#ebebeb":"#000000");var l=document.getElementById("sync-icon");if(!l){l=document.createElement("link");l.id="sync-icon";l.rel="icon";document.head.appendChild(l)}var h=t==="light"?"${LIGHT_ICON}":"${DARK_ICON}";if(l.getAttribute("href")!==h)l.setAttribute("href",h)}a();m.addEventListener("change",a);window.__applyTheme=a}catch(e){}})();`;

const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    return (localStorage.getItem(THEME_KEY) as ThemePref) || "system";
  } catch {
    return "system";
  }
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "system" as ThemePref,
  );
  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {}
    (window as unknown as { __applyTheme?: () => void }).__applyTheme?.();
    listeners.forEach((l) => l());
  };
  return [pref, set];
}
