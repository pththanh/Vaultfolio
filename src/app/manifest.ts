import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "Vaultfolio",
    short_name: "Vaultfolio",
    description: "Quản lý tài sản và thu chi cá nhân",
    lang: "vi",
    start_url: "/admin/cashbook",
    scope: "/",
    display: "standalone",
    background_color: "#F4F5F2",
    theme_color: "#F4F5F2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
