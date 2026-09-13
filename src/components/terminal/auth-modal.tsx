"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { API_KEY_PREFIX, DEMO_API_KEY, storeApiKey } from "@/lib/api-key";
import { APP_NAME } from "@/lib/constant";

const API_KEY_FORMAT = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_]{16,}$`);

interface AuthModalProps {
  onAuthenticate: (apiKey: string, demo: boolean) => void;
  version?: string;
}

export function AuthModal({
  onAuthenticate,
  version = "v0.1.0",
}: AuthModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("API KEY REQUIRED");
      return;
    }
    if (!API_KEY_FORMAT.test(trimmed)) {
      setError("INVALID KEY FORMAT");
      return;
    }

    setIsAuthenticating(true);
    try {
      const res = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (!res.ok || !payload?.ok) {
        setError("INVALID API KEY");
        setIsAuthenticating(false);
        return;
      }
      storeApiKey(trimmed);
      onAuthenticate(trimmed, false);
    } catch {
      setError("CONNECTION ERROR — RETRY");
      setIsAuthenticating(false);
    }
  }

  async function handleDemo() {
    setError("");
    setIsDemoLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    storeApiKey(DEMO_API_KEY);
    onAuthenticate(DEMO_API_KEY, true);
  }

  const isBusy = isAuthenticating || isDemoLoading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />

      <div className="relative z-10 w-full max-w-md border border-border bg-card p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="size-1.5 shrink-0 rounded-full bg-terminal-green animate-pulse-soft" />
            <h1
              id="auth-title"
              className="text-3xl font-bold tracking-[0.25em] text-foreground"
            >
              {APP_NAME.toUpperCase()}
            </h1>
            <span className="size-1.5 shrink-0 rounded-full bg-terminal-green animate-pulse-soft" />
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Agent Swarm Trading Terminal
          </p>
        </div>

        <p className="mt-3 text-center text-xs leading-relaxed text-secondary-foreground">
          Autonomous multi-agent trading with consensus-driven execution
        </p>

        <Separator className="my-6" />

        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={error ? "true" : undefined}>
              <FieldLabel
                htmlFor="api-key"
                className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
              >
                API Key
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText className="font-mono text-terminal-green">
                    {">"}
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setError("");
                  }}
                  placeholder={`${API_KEY_PREFIX}...`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "api-key-error" : undefined}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={isBusy}
                  className="font-mono text-sm tracking-wide placeholder:text-terminal-dim"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError
                id="api-key-error"
                className="text-[10px] font-bold uppercase tracking-widest"
              >
                {error}
              </FieldError>
            </Field>
          </FieldGroup>

          <Button
            type="submit"
            size="lg"
            disabled={isBusy}
            className="mt-4 w-full text-xs font-bold uppercase tracking-widest"
          >
            {isAuthenticating && <Spinner data-icon="inline-start" />}
            {isAuthenticating ? "CONNECTING..." : "ENABLE TERMINAL"}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            or
          </span>
          <Separator className="flex-1" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={isBusy}
          onClick={handleDemo}
          className="w-full text-xs font-bold uppercase tracking-widest"
        >
          {isDemoLoading && <Spinner data-icon="inline-start" />}
          {isDemoLoading ? "LOADING DEMO..." : "Try Demo"}
        </Button>

        <Separator className="mt-6" />
        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-terminal-dim">
          {version} · {APP_NAME} · Agent Swarm Trading Terminal
        </p>
      </div>
    </div>
  );
}
