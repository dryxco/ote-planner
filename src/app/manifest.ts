import type { MetadataRoute } from "next";

// Lets "Add to Home Screen" open Ote full screen (no browser bars).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ote",
    short_name: "Ote",
    description: "Plan your day, record what actually happened.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
