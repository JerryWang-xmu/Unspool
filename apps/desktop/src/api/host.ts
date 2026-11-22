import { invoke } from "@tauri-apps/api/core";
import type { HostEnvironment } from "./types";

interface TauriAppEnvironment {
  readonly appVersion: string;
  readonly platform: string;
}

interface TauriRunnerConnection {
  readonly runnerUrl: string;
  readonly token: string;
}

type RunnerWindow = Window & {
  __UNSPOOL_RUNNER_URL__?: string;
  __UNSPOOL_RUNNER_TOKEN__?: string;
  __UNSPOOL_RUNNER_CONFIG_ERROR__?: string;
};

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as Window & { readonly __TAURI_INTERNALS__?: unknown })
  );
}

/** Load the per-user local connection before the renderer constructs its Runner client. */
export async function prepareRunnerConnection(): Promise<void> {
  if (!isTauriRuntime()) return;
  const connection = await invoke<TauriRunnerConnection>("runner_connection");
  const target = window as RunnerWindow;
  target.__UNSPOOL_RUNNER_URL__ = connection.runnerUrl;
  target.__UNSPOOL_RUNNER_TOKEN__ = connection.token;
}

function browserEnvironment(note?: string): HostEnvironment {
  return {
    appVersion: "web",
    platform: typeof navigator === "undefined" ? "browser" : navigator.platform || "browser",
    mode: "browser",
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * The desktop bridge is limited to environment metadata and the per-user
 * connection bootstrap. Domain data always crosses the versioned Runner API,
 * so the renderer keeps working in a plain browser when the bridge is absent.
 */
export async function loadHostEnvironment(): Promise<HostEnvironment> {
  if (!isTauriRuntime()) {
    return browserEnvironment(
      "Browser Runner API mode: no Tauri command bridge was detected. Runner requests use the HTTP API.",
    );
  }

  try {
    const environment = await invoke<TauriAppEnvironment>("app_environment");
    const configurationError = (window as RunnerWindow).__UNSPOOL_RUNNER_CONFIG_ERROR__;
    return {
      appVersion: environment.appVersion,
      platform: environment.platform,
      mode: "tauri",
      ...(configurationError === undefined ? {} : { note: configurationError }),
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return browserEnvironment(
      `The desktop command bridge was unavailable (${detail}). Runner requests use the HTTP API instead.`,
    );
  }
}
