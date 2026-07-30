import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ink Ritual — Chinese brushwork study",
  description: "A small generative study in Chinese brushwork.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
