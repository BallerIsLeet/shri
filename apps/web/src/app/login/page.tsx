"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: form.get("user"),
        pass: form.get("pass"),
      }),
    });
    setLoading(false);
    if (res.ok) {
      const next = searchParams.get("next") ?? "/";
      router.push(next);
    } else {
      setError("Invalid credentials.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="card">
          <h1 className="mb-6 text-xl font-semibold tracking-tight">
            Sign in to shri
          </h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="user" className="label">
                Username
              </label>
              <input
                id="user"
                name="user"
                type="text"
                autoComplete="username"
                required
                className="input"
              />
            </div>
            <div>
              <label htmlFor="pass" className="label">
                Password
              </label>
              <input
                id="pass"
                name="pass"
                type="password"
                autoComplete="current-password"
                required
                className="input"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
