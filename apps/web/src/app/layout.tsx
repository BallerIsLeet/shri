import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
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
        <TrpcProvider>
          <div className="min-h-screen">
            <header className="border-b border-ink/10 bg-white">
              <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                <Link
                  href="/"
                  className="text-lg font-semibold tracking-tight no-underline"
                >
                  shri
                </Link>
                <nav className="flex items-center gap-4 text-sm">
                  <Link href="/" className="no-underline hover:underline">
                    Projects
                  </Link>
                  <Link href="/jobs" className="no-underline hover:underline">
                    Jobs
                  </Link>
                </nav>
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
          </div>
        </TrpcProvider>
      </body>
    </html>
  );
}
