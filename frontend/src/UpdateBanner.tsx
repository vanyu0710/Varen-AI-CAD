import type { UpdateCheck, UpdateInstall } from "./api";
import { useT } from "./i18n";

type Props = {
  update: UpdateCheck | null;
  install: UpdateInstall | null;
  dismissed: boolean;
  onDismiss: () => void;
  onStart: (version: string) => void;
  onCancel: (jobId: string) => void;
};

const ACTIVE_STATUSES = new Set(["queued", "downloading", "verifying", "staging"]);

export default function UpdateBanner({ update, install, dismissed, onDismiss, onStart, onCancel }: Props) {
  const t = useT();
  const activeInstall = install && ACTIVE_STATUSES.has(install.status) ? install : null;
  const readyInstall = install?.status === "ready" ? install : null;
  const finishedInstall = install && !activeInstall && !readyInstall ? install : null;
  const showUpdateNotice = update?.status === "ok" && update.update_available;
  if ((!showUpdateNotice && !activeInstall && !readyInstall && !finishedInstall) || dismissed) {
    return null;
  }

  const title = activeInstall
    ? t("update.install.progress", { status: t(`update.status.${activeInstall.status}`) })
    : readyInstall
      ? t("update.install.ready_title", { version: readyInstall.version })
      : finishedInstall
        ? finishedInstall.status === "failed"
          ? t("update.install.failed_title")
          : t("update.install.cancelled_title")
        : t("update.banner.title", { version: update?.latest_version || "" });
  const detail = activeInstall
    ? activeInstall.message || t("update.install.default_progress")
    : readyInstall
      ? t("update.install.ready_detail")
      : finishedInstall
        ? finishedInstall.message
        : t("update.banner.current", { version: update?.current_version || "" });
  const hint = activeInstall
    ? t("update.install.active_hint")
    : readyInstall
      ? t("update.install.restart_hint")
      : finishedInstall
        ? t("update.install.finished_hint")
        : t("update.banner.hint");

  return (
    <div className={`update-banner${readyInstall ? " update-banner-ready" : ""}${finishedInstall?.status === "failed" ? " update-banner-error" : ""}`} role="status">
      <span className="update-banner-message">
        <strong>{title}</strong>
        <span>{detail}</span>
        <small>{hint}</small>
      </span>
      <span className="update-banner-actions">
        {update?.release_url && (
          <a className="update-banner-link" href={update.release_url} target="_blank" rel="noreferrer noopener">
            {t("update.banner.view_release")}
          </a>
        )}
        {showUpdateNotice && !activeInstall && !readyInstall && (
          <button
            type="button"
            className="update-banner-action"
            onClick={() => onStart(update.latest_version || "")}
          >
            {t("update.install.start")}
          </button>
        )}
        {(activeInstall || readyInstall) && (
          <button
            type="button"
            className="update-banner-action"
            onClick={() => onCancel((activeInstall || readyInstall)!.job_id)}
          >
            {t("update.install.cancel")}
          </button>
        )}
        <button type="button" className="update-banner-close" onClick={onDismiss} aria-label={t("update.banner.dismiss")}>
          ×
        </button>
      </span>
    </div>
  );
}
