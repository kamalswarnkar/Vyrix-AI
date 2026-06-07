import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vyrix Chatbot Demo",
  description: "Temporary frontend for demonstrating the Vyrix local chatbot flow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
