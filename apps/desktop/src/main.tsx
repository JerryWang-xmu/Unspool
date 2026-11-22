import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isTauriRuntime, prepareRunnerConnection } from "./api/host";
import "./styles.css";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Unspool renderer is missing its #root container");
}

async function bootstrap(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      await prepareRunnerConnection();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      (
        window as Window & { __UNSPOOL_RUNNER_CONFIG_ERROR__?: string }
      ).__UNSPOOL_RUNNER_CONFIG_ERROR__ =
        `The local Runner connection could not be loaded. Run Start-Unspool-Runner.cmd, then restart this client. ${detail}`;
    }
  }
  if (container === null) return;
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
