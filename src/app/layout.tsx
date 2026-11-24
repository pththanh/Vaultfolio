import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppRuntime } from "@/components/vf/app-runtime";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Vaultfolio", template: "%s · Vaultfolio" },
  description: "Quản lý tài sản cá nhân: cổ phiếu, crypto, vàng, tiết kiệm",
  appleWebApp: {
    capable: true,
    title: "Vaultfolio",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#F4F5F2",
  viewportFit: "cover",
  // Android: the keyboard resizes the page instead of covering it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${beVietnam.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <AppRuntime />
        <Toaster
          position="bottom-right"
          offset={{ bottom: 88 }}
          mobileOffset={{ bottom: 88 }}
        />
      </body>
    </html>
  );
}
