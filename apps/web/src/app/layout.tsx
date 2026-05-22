import "./globals.css";
import type { ReactNode } from "react";
import { TrpcProvider } from "@/components/TrpcProvider";

export const metadata = {
  title: "Shri",
  description: "Automated marketing content studio.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body>
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
