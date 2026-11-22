import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ArtifactView,
  BackupStatus,
  DownloadPhase,
  RunnerClient,
  UsageSummary,
} from "../../api/types";

export interface ArtifactPanelClient {
  readonly listArtifacts: RunnerClient["listArtifacts"];
  readonly uploadArtifact: RunnerClient["uploadArtifact"];
  readonly downloadArtifact: RunnerClient["downloadArtifact"];
  readonly getUsage?: RunnerClient["getUsage"];
  readonly getBackupStatus?: RunnerClient["getBackupStatus"];
}

export interface ArtifactPanelProps {
  readonly client: ArtifactPanelClient;
  readonly workspaceId: string;
  readonly runId?: string | undefined;
  readonly refreshToken?: number | undefined;
  readonly maxUploadBytes?: number | undefined;
  readonly onUploaded?: ((artifact: ArtifactView) => void) | undefined;
}

type UploadPhase = "idle" | "hashing" | "uploading" | "done" | "error";
type ListState = "loading" | "ready" | "error";
type PreviewState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly artifactId: string }
  | {
      readonly phase: "text";
      readonly artifactId: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | { readonly phase: "image"; readonly artifactId: string; readonly url: string }
  | { readonly phase: "unsupported"; readonly artifactId: string; readonly message: string }
  | { readonly phase: "error"; readonly artifactId: string; readonly message: string };

const PREVIEW_TEXT_LIMIT = 200_000;

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return String(cause);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "size unknown";
  }
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "size unavailable";
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

function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") ||
    mediaType.includes("json") ||
    mediaType.includes("xml") ||
    mediaType.includes("yaml") ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-javascript" ||
    mediaType === "application/x-sh" ||
    mediaType === "application/sql"
  );
}

function availabilityLabel(availability: ArtifactView["availability"]): string {
  switch (availability) {
    case "available":
      return "Available";
    case "missing":
      return "Missing";
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}

function backupStateLabel(state: BackupStatus["state"]): string {
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

function formatCount(value: number | undefined): string {
  return value === undefined ? "Not reported" : new Intl.NumberFormat("en-US").format(value);
}

export function ArtifactPanel({
  client,
  workspaceId,
  runId,
  refreshToken,
  maxUploadBytes,
  onUploaded,
}: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<readonly ArtifactView[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [downloadPhase, setDownloadPhase] = useState<DownloadPhase>({ phase: "idle" });
  const [preview, setPreview] = useState<PreviewState>({ phase: "idle" });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRequest = useRef(0);
  const uploadInputId = useId();

  const listArtifacts = client.listArtifacts;
  const uploadArtifact = client.uploadArtifact;
  const downloadArtifact = client.downloadArtifact;
  const getUsage = client.getUsage;
  const getBackupStatus = client.getBackupStatus;

  useEffect(() => {
    void workspaceId;
    setArtifacts([]);
    setSelectedArtifactId(null);
    setPreview({ phase: "idle" });
    setDownloadPhase({ phase: "idle" });
    setUploadPhase("idle");
    setUploadMessage("");
    previewRequest.current += 1;
    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshToken;
    void reloadNonce;
    let active = true;
    if (workspaceId.trim().length === 0) {
      setArtifacts([]);
      setListError(null);
      setListState("ready");
      return () => {
        active = false;
      };
    }

    setListState("loading");
    setListError(null);
    void listArtifacts(workspaceId)
      .then((items) => {
        if (active) {
          setArtifacts(items);
          setListState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setListError(errorMessage(cause));
          setListState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [listArtifacts, workspaceId, refreshToken, reloadNonce]);

  const orderedArtifacts = useMemo(
    () =>
      [...artifacts].sort((left, right) => {
        const byName = left.name.localeCompare(right.name);
        return byName !== 0 ? byName : right.version - left.version;
      }),
    [artifacts],
  );

  useEffect(() => {
    if (orderedArtifacts.length === 0) {
      if (selectedArtifactId !== null) {
        setSelectedArtifactId(null);
      }
      return;
    }
    if (
      selectedArtifactId !== null &&
      orderedArtifacts.some((artifact) => artifact.id === selectedArtifactId)
    ) {
      return;
    }
    const first =
      orderedArtifacts.find((artifact) => artifact.availability === "available") ??
      orderedArtifacts[0];
    if (first !== undefined) {
      setSelectedArtifactId(first.id);
    }
  }, [orderedArtifacts, selectedArtifactId]);

  useEffect(() => {
    void selectedArtifactId;
    setPreview({ phase: "idle" });
    setDownloadPhase({ phase: "idle" });
    previewRequest.current += 1;
  }, [selectedArtifactId]);

  useEffect(() => {
    const currentPreview = preview;
    return () => {
      if (currentPreview.phase === "image") {
        URL.revokeObjectURL(currentPreview.url);
      }
    };
  }, [preview]);

  useEffect(() => {
    void refreshToken;
    let active = true;
    if (getUsage === undefined || runId === undefined || runId.trim().length === 0) {
      setUsage(null);
      setUsageError(null);
      setUsageLoading(false);
      return () => {
        active = false;
      };
    }

    setUsageLoading(true);
    setUsageError(null);
    void getUsage(workspaceId, runId)
      .then((summary) => {
        if (active) {
          setUsage(summary);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setUsage(null);
          setUsageError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (active) {
          setUsageLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [getUsage, workspaceId, runId, refreshToken]);

  useEffect(() => {
    void refreshToken;
    let active = true;
    if (getBackupStatus === undefined) {
      setBackup(null);
      setBackupError(null);
      setBackupLoading(false);
      return () => {
        active = false;
      };
    }

    setBackupLoading(true);
    setBackupError(null);
    void getBackupStatus()
      .then((status) => {
        if (active) {
          setBackup(status);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setBackup(null);
          setBackupError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (active) {
          setBackupLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [getBackupStatus, refreshToken]);

  const selectedArtifact =
    selectedArtifactId === null
      ? null
      : (orderedArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null);

  const uploadBusy = uploadPhase === "hashing" || uploadPhase === "uploading";

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
    setUploadPhase("idle");
    setUploadMessage("");
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null || uploadBusy || workspaceId.trim().length === 0) {
      return;
    }
    if (maxUploadBytes !== undefined && file.size > maxUploadBytes) {
      setUploadPhase("error");
      setUploadMessage(
        `The selected file is larger than the ${formatBytes(maxUploadBytes)} upload limit.`,
      );
      return;
    }

    setUploadPhase("hashing");
    setUploadMessage(`Hashing ${file.name}…`);
    try {
      const uploaded = await uploadArtifact(workspaceId, file, (phase) => {
        setUploadPhase(phase);
        setUploadMessage(phase === "hashing" ? `Hashing ${file.name}…` : `Uploading ${file.name}…`);
      });
      setUploadPhase("done");
      setUploadMessage(`${uploaded.name} version ${uploaded.version} uploaded.`);
      setFile(null);
      if (inputRef.current !== null) {
        inputRef.current.value = "";
      }
      setReloadNonce((value) => value + 1);
      try {
        onUploaded?.(uploaded);
      } catch {
        // A host callback must not turn a completed upload into a UI error.
      }
    } catch (cause) {
      setUploadPhase("error");
      setUploadMessage(errorMessage(cause));
    }
  }

  async function handlePreview(artifact: ArtifactView): Promise<void> {
    if (artifact.availability !== "available") {
      return;
    }
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setPreview({ phase: "loading", artifactId: artifact.id });

    try {
      const blob = await downloadArtifact(workspaceId, artifact);
      if (previewRequest.current !== requestId) {
        return;
      }
      const mediaType =
        artifact.mediaType.trim().length > 0
          ? artifact.mediaType.toLowerCase()
          : blob.type.toLowerCase();

      if (mediaType.startsWith("image/")) {
        const url = URL.createObjectURL(blob);
        if (previewRequest.current !== requestId) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreview({ phase: "image", artifactId: artifact.id, url });
        return;
      }

      if (isTextMediaType(mediaType)) {
        const text = await blob.text();
        if (previewRequest.current !== requestId) {
          return;
        }
        setPreview({
          phase: "text",
          artifactId: artifact.id,
          text: text.slice(0, PREVIEW_TEXT_LIMIT),
          truncated: text.length > PREVIEW_TEXT_LIMIT,
        });
        return;
      }

      setPreview({
        phase: "unsupported",
        artifactId: artifact.id,
        message: `Preview is not available for ${mediaType.length > 0 ? mediaType : "this media type"}. Download the artifact to inspect it.`,
      });
    } catch (cause) {
      if (previewRequest.current === requestId) {
        setPreview({ phase: "error", artifactId: artifact.id, message: errorMessage(cause) });
      }
    }
  }

  async function handleDownload(artifact: ArtifactView): Promise<void> {
    if (artifact.availability !== "available" || downloadPhase.phase === "downloading") {
      return;
    }
    setDownloadPhase({ phase: "downloading", artifactId: artifact.id });
    try {
      const blob = await downloadArtifact(workspaceId, artifact);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        artifact.name.trim().length > 0 ? artifact.name : `artifact-v${artifact.version}`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDownloadPhase({
        phase: "done",
        message: `Downloaded ${artifact.name} version ${artifact.version} (${formatBytes(blob.size)}).`,
      });
    } catch (cause) {
      setDownloadPhase({ phase: "error", message: errorMessage(cause) });
    }
  }

  const usageUnavailableReason =
    usageError ??
    (usage !== null && !usage.available
      ? (usage.reason ?? "Upstream usage data is unavailable.")
      : null) ??
    (runId === undefined || runId.trim().length === 0
      ? "Usage is unavailable until a Run is selected."
      : getUsage === undefined
        ? "This Runner does not provide usage reporting."
        : null);

  return (
    <section
      className="artifact-panel"
      data-testid="artifact-panel"
      aria-labelledby="artifact-panel-title"
    >
      <header className="artifact-panel__header">
        <div>
          <p className="artifact-panel__eyebrow">Reference material</p>
          <h2 id="artifact-panel-title">Artifacts</h2>
        </div>
        <button
          type="button"
          data-testid="refresh-artifacts"
          disabled={listState === "loading"}
          onClick={() => setReloadNonce((value) => value + 1)}
        >
          {listState === "loading" ? "Refreshing…" : "Refresh artifacts"}
        </button>
      </header>

      <form className="artifact-panel__upload" onSubmit={(event) => void handleUpload(event)}>
        <h3>Upload a reference artifact</h3>
        <label htmlFor={uploadInputId}>Reference file</label>
        <input
          ref={inputRef}
          id={uploadInputId}
          data-testid="artifact-upload-input"
          type="file"
          disabled={uploadBusy}
          onChange={handleFileChange}
        />
        <button
          type="submit"
          data-testid="upload-artifact"
          disabled={file === null || uploadBusy || workspaceId.trim().length === 0}
        >
          {uploadPhase === "hashing"
            ? "Hashing…"
            : uploadPhase === "uploading"
              ? "Uploading…"
              : "Upload artifact"}
        </button>
        <p
          className={`artifact-panel__upload-status artifact-panel__upload-status--${uploadPhase}`}
          data-testid="artifact-upload-status"
          data-phase={uploadPhase}
          role="status"
          aria-live="polite"
        >
          {uploadMessage.length > 0
            ? uploadMessage
            : "Choose a file to upload as a reference artifact."}
        </p>
        {maxUploadBytes !== undefined ? (
          <p data-testid="artifact-upload-limit">
            Maximum upload size for this Runner: {formatBytes(maxUploadBytes)}.
          </p>
        ) : null}
      </form>

      <div className="artifact-panel__body">
        <section aria-labelledby="artifact-list-heading">
          <h3 id="artifact-list-heading">Versions</h3>
          {listState === "loading" ? (
            <p data-testid="artifact-list-loading" role="status">
              Loading artifacts…
            </p>
          ) : null}
          {listError !== null ? (
            <p className="artifact-panel__error" data-testid="artifact-list-error" role="alert">
              Artifacts could not be loaded: {listError}
            </p>
          ) : null}
          <ul className="artifact-panel__list" data-testid="artifact-list">
            {orderedArtifacts.length === 0 ? (
              <li data-testid="artifact-empty">
                {listState === "loading" ? "Loading artifacts…" : "No artifacts in this workspace."}
              </li>
            ) : (
              orderedArtifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    data-testid="artifact-item"
                    data-artifact-name={artifact.name}
                    data-artifact-version={String(artifact.version)}
                    data-artifact-id={artifact.artifactId ?? artifact.id}
                    data-availability={artifact.availability}
                    aria-pressed={selectedArtifact?.id === artifact.id}
                    className={
                      selectedArtifact?.id === artifact.id
                        ? "artifact-panel__item artifact-panel__item--selected"
                        : "artifact-panel__item"
                    }
                    onClick={() => setSelectedArtifactId(artifact.id)}
                  >
                    <span className="artifact-panel__item-name">{artifact.name}</span>
                    <span className="artifact-panel__item-version">v{artifact.version}</span>
                    <span className="artifact-panel__item-meta">
                      {artifact.kind} · {artifact.mediaType} · {formatBytes(artifact.size)}
                    </span>
                    <span
                      className="artifact-panel__item-availability"
                      data-state={artifact.availability}
                    >
                      {availabilityLabel(artifact.availability)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="artifact-panel__preview" data-testid="artifact-preview">
          <h3>Preview</h3>
          {selectedArtifact === null ? (
            <p>Select an artifact version to preview it.</p>
          ) : (
            <>
              <dl className="artifact-panel__facts">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedArtifact.name}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{selectedArtifact.version}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selectedArtifact.mediaType}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(selectedArtifact.size)}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{availabilityLabel(selectedArtifact.availability)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selectedArtifact.sourceSummary ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(selectedArtifact.createdAt)}</dd>
                </div>
                {selectedArtifact.sha256 !== undefined ? (
                  <div>
                    <dt>SHA-256</dt>
                    <dd>
                      <code>{selectedArtifact.sha256}</code>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {selectedArtifact.availability !== "available" ? (
                <p
                  className="artifact-panel__warning"
                  data-testid="artifact-unavailable"
                  role="alert"
                >
                  Artifact content is{" "}
                  {availabilityLabel(selectedArtifact.availability).toLowerCase()}. Preview and
                  download are disabled until the content is available.
                </p>
              ) : null}

              <div className="artifact-panel__preview-actions">
                <button
                  type="button"
                  data-testid="preview-artifact"
                  disabled={
                    selectedArtifact.availability !== "available" || preview.phase === "loading"
                  }
                  onClick={() => void handlePreview(selectedArtifact)}
                >
                  {preview.phase === "loading" ? "Loading preview…" : "Preview"}
                </button>
                <button
                  type="button"
                  data-testid="download-artifact"
                  disabled={
                    selectedArtifact.availability !== "available" ||
                    downloadPhase.phase === "downloading"
                  }
                  onClick={() => void handleDownload(selectedArtifact)}
                >
                  {downloadPhase.phase === "downloading" ? "Downloading…" : "Download"}
                </button>
              </div>

              <div
                className="artifact-panel__preview-content"
                data-testid="artifact-preview-content"
              >
                {preview.phase === "idle" ? (
                  <p>Preview the selected version to load text or an image.</p>
                ) : null}
                {preview.phase === "loading" ? <p role="status">Loading preview…</p> : null}
                {preview.phase === "text" ? (
                  <>
                    <pre data-testid="artifact-preview-text">{preview.text}</pre>
                    {preview.truncated ? (
                      <p className="artifact-panel__warning">
                        Preview truncated at {PREVIEW_TEXT_LIMIT.toLocaleString("en-US")}{" "}
                        characters. Download the artifact to inspect the full content.
                      </p>
                    ) : null}
                  </>
                ) : null}
                {preview.phase === "image" ? (
                  <img
                    data-testid="artifact-preview-image"
                    src={preview.url}
                    alt={`Preview of ${selectedArtifact.name} version ${selectedArtifact.version}`}
                  />
                ) : null}
                {preview.phase === "unsupported" || preview.phase === "error" ? (
                  <p
                    className="artifact-panel__warning"
                    data-testid="artifact-preview-message"
                    role={preview.phase === "error" ? "alert" : undefined}
                  >
                    {preview.message}
                  </p>
                ) : null}
              </div>

              <p
                className={`artifact-panel__download-status artifact-panel__download-status--${downloadPhase.phase}`}
                data-testid="artifact-download-status"
                data-phase={downloadPhase.phase}
                role="status"
                aria-live="polite"
              >
                {downloadPhase.phase === "idle"
                  ? "Range-capable download ready."
                  : downloadPhase.phase === "downloading"
                    ? "Requesting artifact bytes…"
                    : downloadPhase.message}
              </p>
            </>
          )}
        </section>
      </div>

      <div className="artifact-panel__footer">
        <section data-testid="usage-summary" aria-labelledby="usage-summary-heading">
          <h3 id="usage-summary-heading">Usage</h3>
          {usageLoading ? (
            <p role="status">Loading usage…</p>
          ) : usage !== null && usage.available ? (
            <dl>
              <div>
                <dt>Provider</dt>
                <dd>{usage.provider ?? "Not reported"}</dd>
              </div>
              <div>
                <dt>Input tokens</dt>
                <dd>{formatCount(usage.inputTokens)}</dd>
              </div>
              <div>
                <dt>Output tokens</dt>
                <dd>{formatCount(usage.outputTokens)}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  {usage.costAmount === undefined
                    ? "Not reported"
                    : `${usage.costAmount}${usage.costCurrency === undefined ? "" : ` ${usage.costCurrency}`}`}
                </dd>
              </div>
              <div>
                <dt>Reliability</dt>
                <dd>{usage.reliability ?? "Not reported"}</dd>
              </div>
            </dl>
          ) : (
            <p data-testid="usage-unavailable">
              Usage unavailable
              {usageUnavailableReason === null ? "." : `: ${usageUnavailableReason}`}
            </p>
          )}
        </section>

        <section data-testid="backup-status" data-state={backup?.state ?? "unavailable"}>
          <h3>Backup</h3>
          {backupLoading ? (
            <p role="status">Checking backup status…</p>
          ) : backup !== null ? (
            <>
              <p>
                State: <strong>{backupStateLabel(backup.state)}</strong>
              </p>
              {backup.message !== undefined ? <p>{backup.message}</p> : null}
              {backup.lastBackupAt !== undefined ? (
                <p>Last backup: {formatTimestamp(backup.lastBackupAt)}</p>
              ) : null}
              {backup.manifestId !== undefined ? <p>Manifest: {backup.manifestId}</p> : null}
              {backup.manifestDigest !== undefined ? (
                <p>
                  Digest: <code>{backup.manifestDigest}</code>
                </p>
              ) : null}
            </>
          ) : (
            <p data-testid="backup-unavailable">
              {getBackupStatus === undefined
                ? "Backup status is unavailable from this Runner."
                : backupError !== null
                  ? `Backup status unavailable: ${backupError}`
                  : "Backup status has not been reported."}
            </p>
          )}
          {backupError !== null && backup !== null ? (
            <p className="artifact-panel__error" data-testid="backup-status-error" role="alert">
              {backupError}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
