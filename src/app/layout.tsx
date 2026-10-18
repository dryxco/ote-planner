import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ote",
  description: "Plan your day, record what actually happened, and see how well they sync.",
  // "black" (opaque), not "black-translucent": with a translucent status bar iOS home-screen apps get a
  // web view that ends ~one status-bar height above the screen bottom, leaving a dead strip there.
  appleWebApp: { capable: true, title: "Ote", statusBarStyle: "black" },
  // the tab icon is set by THEME_SCRIPT (it follows the theme); without script, /favicon.ico
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full bg-bg text-text">{children}</body>
    </html>
  );
}
