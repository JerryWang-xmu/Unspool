import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import type {
  BackupState,
  BackupStatus,
  ConnectionState,
  ModelProfileSummary,
  RunnerClient,
  RunnerHealth,
  RunnerSummary,
} from "../../api/types";

export interface RunnerSettingsClient {
  readonly getHealth: RunnerClient["getHealth"];
  readonly listRunners: RunnerClient["listRunners"];
  readonly listModelProfiles: RunnerClient["listModelProfiles"];
  readonly getBackupStatus?: RunnerClient["getBackupStatus"];
  readonly runBackup?: RunnerClient["runBackup"];
}

export interface RunnerPersonalPreferences {
  readonly displayName: string;
  readonly timezone: string;
  readonly timelineDensity: "comfortable" | "compact";
}

export interface RunnerSelection {
  readonly runnerId: string;
  readonly modelProfileId: string;
}

export interface RunnerSettingsProps {
  readonly client: RunnerSettingsClient;
  readonly selectedRunnerId?: string | undefined;
  readonly selectedModelProfileId?: string | undefined;
  readonly preferences?: RunnerPersonalPreferences | undefined;
  readonly refreshToken?: number | undefined;
  readonly onSelectionChange?: ((selection: RunnerSelection) => void) | undefined;
  readonly onPreferencesChange?: ((preferences: RunnerPersonalPreferences) => void) | undefined;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return String(cause);
}

function defaultPreferences(): RunnerPersonalPreferences {
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    timezone = "UTC";
  }
  return { displayName: "", timezone, timelineDensity: "comfortable" };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unavailable";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const unit = units[index] ?? "TB";
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return "Not recorded";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

type SettingsConnectionState = ConnectionState | "stale";

function connectionStateFor(
  online: boolean,
  healthLoading: boolean,
  health: RunnerHealth | null,
  healthError: string | null,
): SettingsConnectionState {
  if (!online || healthError !== null) {
    return "stale";
  }
  if (health === null) {
    return healthLoading ? "connecting" : "stale";
  }
  return health.status === "degraded" ? "degraded" : "available";
}

function connectionStateLabel(state: SettingsConnectionState): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "available":
      return "Available";
    case "degraded":
      return "Degraded";
    case "offline":
      return "Offline";
    case "stale":
      return "Stale";
    default:
      return state;
  }
}

function backupStateLabel(state: BackupState): string {
  switch (state) {
    case "unavailable":
      return "Unavailable";
    case "never_run":
      return "Never run";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    default:
      return "Unavailable";
  }
}

export function RunnerSettings({
  client,
  selectedRunnerId,
  selectedModelProfileId,
  preferences,
  refreshToken,
  onSelectionChange,
  onPreferencesChange,
}: RunnerSettingsProps) {
  const [health, setHealth] = useState<RunnerHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [lastHealthAt, setLastHealthAt] = useState<string | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const [runners, setRunners] = useState<readonly RunnerSummary[]>([]);
  const [runnersLoading, setRunnersLoading] = useState(true);
  const [runnersError, setRunnersError] = useState<string | null>(null);
  const [internalRunnerId, setInternalRunnerId] = useState("");
  const [models, setModels] = useState<readonly ModelProfileSummary[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [internalModelId, setInternalModelId] = useState("");

  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [internalPreferences, setInternalPreferences] =
    useState<RunnerPersonalPreferences>(defaultPreferences);
  const [reloadNonce, setReloadNonce] = useState(0);

  const getHealth = client.getHealth;
  const listRunners = client.listRunners;
  const listModelProfiles = client.listModelProfiles;
  const getBackupStatus = client.getBackupStatus;
  const runBackup = client.runBackup;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleOnline = (): void => {
      setOnline(true);
      setReloadNonce((value) => value + 1);
    };
    const handleOffline = (): void => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    void refreshToken;
    void reloadNonce;
    let active = true;
    setHealthLoading(true);
    void getHealth()
      .then((next) => {
        if (!active) {
          return;
        }
        setHealth(next);
        setHealthError(null);
        setLastHealthAt(new Date().toISOString());
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setHealthError(errorMessage(cause));
      })
      .finally(() => {
        if (active) {
          setHealthLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [getHealth, refreshToken, reloadNonce]);

  useEffect(() => {
    void refreshToken;
    void reloadNonce;
    let active = true;
    setRunnersLoading(true);
    void listRunners()
      .then((next) => {
        if (!active) {
          return;
        }
        setRunners(next);
        setRunnersError(null);
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setRunnersError(errorMessage(cause));
      })
      .finally(() => {
        if (active) {
          setRunnersLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [listRunners, refreshToken, reloadNonce]);

  useEffect(() => {
    if (selectedRunnerId !== undefined) {
      return;
    }
    if (runners.length === 0) {
      if (internalRunnerId !== "") {
        setInternalRunnerId("");
      }
      return;
    }
    if (runners.some((runner) => runner.id === internalRunnerId)) {
      return;
    }
    const first = runners.find((runner) => runner.status === "available") ?? runners[0];
    if (first !== undefined) {
      setInternalRunnerId(first.id);
    }
  }, [runners, internalRunnerId, selectedRunnerId]);

  const runnerId = selectedRunnerId !== undefined ? selectedRunnerId : internalRunnerId;
  const modelProfileId =
    selectedModelProfileId !== undefined ? selectedModelProfileId : internalModelId;

  useEffect(() => {
    void refreshToken;
    void reloadNonce;
    let active = true;
    setModels([]);
    setModelsError(null);
    if (runnerId.trim().length === 0) {
      setModelsLoading(false);
      return () => {
        active = false;
      };
    }

    setModelsLoading(true);
    void listModelProfiles(runnerId)
      .then((next) => {
        if (!active) {
          return;
        }
        setModels(next);
        setModelsError(null);
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setModelsError(errorMessage(cause));
      })
      .finally(() => {
        if (active) {
          setModelsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [listModelProfiles, runnerId, refreshToken, reloadNonce]);

  useEffect(() => {
    if (selectedModelProfileId !== undefined) {
      return;
    }
    if (models.length === 0) {
      if (internalModelId !== "") {
        setInternalModelId("");
      }
      return;
    }
    if (models.some((model) => model.id === internalModelId)) {
      return;
    }
    const first = models.find((model) => model.enabled) ?? models[0];
    if (first !== undefined) {
      setInternalModelId(first.id);
    }
  }, [models, internalModelId, selectedModelProfileId]);

  useEffect(() => {
    void refreshToken;
    void reloadNonce;
    let active = true;
    if (getBackupStatus === undefined) {
      setBackupLoading(false);
      return () => {
        active = false;
      };
    }
    setBackupLoading(true);
    void getBackupStatus()
      .then((next) => {
        if (!active) {
          return;
        }
        setBackup(next);
        setBackupError(null);
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        setBackupError(errorMessage(cause));
      })
      .finally(() => {
        if (active) {
          setBackupLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [getBackupStatus, refreshToken, reloadNonce]);

  const selectedRunner = runners.find((runner) => runner.id === runnerId) ?? null;
  const selectedModel = models.find((model) => model.id === modelProfileId) ?? null;

  const effectivePreferences: RunnerPersonalPreferences = {
    displayName: preferences?.displayName ?? internalPreferences.displayName,
    timezone: preferences?.timezone ?? internalPreferences.timezone,
    timelineDensity: preferences?.timelineDensity ?? internalPreferences.timelineDensity,
  };

  const connectionState = connectionStateFor(online, healthLoading, health, healthError);

  function handleRunnerChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextRunnerId = event.target.value;
    setInternalRunnerId(nextRunnerId);
    setInternalModelId("");
    onSelectionChange?.({ runnerId: nextRunnerId, modelProfileId: "" });
  }

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextModelProfileId = event.target.value;
    setInternalModelId(nextModelProfileId);
    onSelectionChange?.({ runnerId, modelProfileId: nextModelProfileId });
  }

  function updatePreferences(patch: Partial<RunnerPersonalPreferences>): void {
    const next: RunnerPersonalPreferences = {
      displayName: patch.displayName ?? effectivePreferences.displayName,
      timezone: patch.timezone ?? effectivePreferences.timezone,
      timelineDensity: patch.timelineDensity ?? effectivePreferences.timelineDensity,
    };
    if (preferences === undefined) {
      setInternalPreferences(next);
    }
    onPreferencesChange?.(next);
  }

  async function handleRunBackup(): Promise<void> {
    if (runBackup === undefined || backupBusy) {
      return;
    }
    setBackupBusy(true);
    setBackupError(null);
    try {
      const next = await runBackup();
      setBackup(next);
    } catch (cause) {
      setBackupError(errorMessage(cause));
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <section
      className="runner-settings"
      data-testid="runner-settings"
      aria-labelledby="runner-settings-title"
    >
      <header className="runner-settings__header">
        <div>
          <p className="runner-settings__eyebrow">Personal settings</p>
          <h2 id="runner-settings-title">Runner, model, and backup</h2>
          <p>
            Personal workspace only. Team membership is not required, and these display preferences
            are not included when a task is shared.
          </p>
        </div>
        <button
          type="button"
          data-testid="refresh-runner-settings"
          disabled={healthLoading}
          onClick={() => setReloadNonce((value) => value + 1)}
        >
          {healthLoading ? "Refreshing…" : "Refresh status"}
        </button>
      </header>

      <p
        className="runner-settings__connection"
        data-testid="settings-connection"
        data-state={connectionState}
        role="status"
      >
        <strong>Runner connection:</strong> {connectionStateLabel(connectionState)}
        {lastHealthAt !== null ? ` · Last checked ${formatTimestamp(lastHealthAt)}` : ""}
      </p>

      {connectionState === "stale" ? (
        <div className="runner-settings__warning" data-testid="settings-stale-warning" role="alert">
          <strong>The Runner view is stale.</strong>
          <p>
            New actions are not confirmed while the connection is stale. Refresh after the Runner is
            reachable again.
          </p>
        </div>
      ) : null}

      {healthError !== null ? (
        <p className="runner-settings__error" data-testid="settings-health-error" role="alert">
          Runner health check failed: {healthError}
        </p>
      ) : null}

      {health !== null ? (
        <dl className="runner-settings__facts" data-testid="settings-health">
          <div>
            <dt>Service</dt>
            <dd>{health.service}</dd>
          </div>
          <div>
            <dt>Runner version</dt>
            <dd>{health.runnerVersion ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Schema version</dt>
            <dd>{health.schemaVersion ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Support state</dt>
            <dd>{health.supportState ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Upload limit</dt>
            <dd>
              {health.maxUploadBytes === undefined
                ? "Not reported"
                : formatBytes(health.maxUploadBytes)}
            </dd>
          </div>
        </dl>
      ) : null}

      {health !== null && health.dependencies.length > 0 ? (
        <ul className="runner-settings__dependencies" data-testid="settings-dependencies">
          {health.dependencies.map((dependency) => (
            <li key={dependency.name} data-status={dependency.status}>
              {dependency.name}: {dependency.status}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="runner-settings__grid">
        <section className="runner-settings__section" aria-labelledby="settings-runner-heading">
          <h3 id="settings-runner-heading">Runner</h3>
          {runnersLoading ? <p role="status">Loading Runners…</p> : null}
          {runnersError !== null ? (
            <p className="runner-settings__error" data-testid="settings-runners-error" role="alert">
              Runners could not be loaded: {runnersError}
            </p>
          ) : null}

          <label htmlFor="settings-runner-select">Runner</label>
          <select
            id="settings-runner-select"
            data-testid="settings-runner-select"
            value={runnerId}
            disabled={runners.length === 0}
            onChange={handleRunnerChange}
          >
            <option value="">Select a Runner</option>
            {runners.map((runner) => (
              <option key={runner.id} value={runner.id}>
                {runner.name}
              </option>
            ))}
          </select>

          {selectedRunner !== null ? (
            <div
              className="runner-settings__selection"
              data-testid="settings-selected-runner"
              data-runner-id={selectedRunner.id}
              data-status={selectedRunner.status}
            >
              <p>
                <strong>{selectedRunner.name}</strong> · {selectedRunner.status}
              </p>
              {selectedRunner.purpose !== undefined ? <p>{selectedRunner.purpose}</p> : null}
              <p>
                Version: {selectedRunner.version ?? "Not reported"} · Support:{" "}
                {selectedRunner.supportState ?? "Not reported"}
              </p>
            </div>
          ) : (
            <p data-testid="settings-selected-runner">No Runner selected.</p>
          )}

          {runners.length > 0 ? (
            <ul className="runner-settings__runner-list" data-testid="settings-runner-list">
              {runners.map((runner) => (
                <li
                  key={runner.id}
                  data-testid="settings-runner-item"
                  data-runner-id={runner.id}
                  data-status={runner.status}
                >
                  <span>{runner.name}</span>
                  <span>{runner.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="runner-settings__section" aria-labelledby="settings-model-heading">
          <h3 id="settings-model-heading">Model profile</h3>
          {modelsLoading ? <p role="status">Loading model profiles…</p> : null}
          {modelsError !== null ? (
            <p className="runner-settings__error" data-testid="settings-models-error" role="alert">
              Model profiles could not be loaded: {modelsError}
            </p>
          ) : null}

          <label htmlFor="settings-model-profile-select">Model profile</label>
          <select
            id="settings-model-profile-select"
            data-testid="settings-model-profile-select"
            value={modelProfileId}
            disabled={runnerId.trim().length === 0 || models.length === 0}
            onChange={handleModelChange}
          >
            <option value="">Select a model profile</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>

          {selectedModel !== null ? (
            <div
              className="runner-settings__selection"
              data-testid="settings-selected-model-profile"
              data-model-profile-id={selectedModel.id}
              data-enabled={selectedModel.enabled ? "true" : "false"}
            >
              <p>
                <strong>{selectedModel.label}</strong> · {selectedModel.provider}/
                {selectedModel.model}
              </p>
              <p>
                {selectedModel.enabled ? "Enabled" : "Disabled"}
                {selectedModel.runnerId === undefined ? "" : ` · Runner ${selectedModel.runnerId}`}
              </p>
            </div>
          ) : (
            <p data-testid="settings-selected-model-profile">No model profile selected.</p>
          )}

          {!modelsLoading &&
          runnerId.trim().length > 0 &&
          models.length === 0 &&
          modelsError === null ? (
            <p>No model profiles are available for this Runner.</p>
          ) : null}
        </section>

        <section className="runner-settings__section" aria-labelledby="settings-backup-heading">
          <h3 id="settings-backup-heading">Backup</h3>
          {backupLoading ? <p role="status">Checking backup status…</p> : null}
          <div
            className="runner-settings__backup"
            data-testid="settings-backup-status"
            data-state={backup?.state ?? "unavailable"}
          >
            <p>
              State:{" "}
              <strong>{backup === null ? "Unavailable" : backupStateLabel(backup.state)}</strong>
            </p>
            {backup?.message !== undefined ? <p>{backup.message}</p> : null}
            {backup?.lastBackupAt !== undefined ? (
              <p>Last backup: {formatTimestamp(backup.lastBackupAt)}</p>
            ) : null}
            {backup?.manifestId !== undefined ? <p>Manifest: {backup.manifestId}</p> : null}
            {backup?.manifestDigest !== undefined ? (
              <p>
                Digest: <code>{backup.manifestDigest}</code>
              </p>
            ) : null}
            {getBackupStatus === undefined && backup === null ? (
              <p>Backup status is unavailable from this Runner.</p>
            ) : null}
          </div>

          {backupError !== null ? (
            <p className="runner-settings__error" data-testid="settings-backup-error" role="alert">
              Backup operation failed: {backupError}
            </p>
          ) : null}

          {runBackup !== undefined ? (
            <button
              type="button"
              data-testid="run-backup"
              disabled={backupBusy || !online}
              onClick={() => void handleRunBackup()}
            >
              {backupBusy ? "Running backup…" : "Run backup"}
            </button>
          ) : (
            <p>This Runner does not expose a backup command.</p>
          )}
        </section>
      </div>

      <section
        className="runner-settings__section"
        data-testid="settings-personal-preferences"
        aria-labelledby="settings-preferences-heading"
      >
        <h3 id="settings-preferences-heading">Personal preferences</h3>
        <label htmlFor="settings-display-name">Display name</label>
        <input
          id="settings-display-name"
          data-testid="settings-display-name"
          type="text"
          value={effectivePreferences.displayName}
          placeholder="Local owner"
          onChange={(event) => updatePreferences({ displayName: event.target.value })}
        />

        <label htmlFor="settings-timezone">Time zone</label>
        <input
          id="settings-timezone"
          data-testid="settings-timezone"
          type="text"
          value={effectivePreferences.timezone}
          onChange={(event) => updatePreferences({ timezone: event.target.value })}
        />

        <label htmlFor="settings-density">Timeline density</label>
        <select
          id="settings-density"
          data-testid="settings-density"
          value={effectivePreferences.timelineDensity}
          onChange={(event) =>
            updatePreferences({
              timelineDensity: event.target.value === "compact" ? "compact" : "comfortable",
            })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>

        <p>
          Personal display preferences stay outside shared workspace content and are never sent to a
          model.
        </p>
      </section>
    </section>
  );
}
