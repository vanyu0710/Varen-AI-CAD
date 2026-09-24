import type { UpdateCheck } from "./api";
import { useT } from "./i18n";

type Props = {
  update: UpdateCheck | null;
  dismissed: boolean;
  onDismiss: () => void;
};

export default function UpdateBanner({ update, dismissed, onDismiss }: Props) {
  const t = useT();
  if (!update || update.status !== "ok" || !update.update_available || dismissed) {
    return null;
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-message">
        <strong>{t("update.banner.title", { version: update.latest_version || "" })}</strong>
        <span>{t("update.banner.current", { version: update.current_version })}</span>
        <small>{t("update.banner.hint")}</small>
      </span>
      <span className="update-banner-actions">
        {update.release_url && (
          <a
            className="update-banner-link"
            href={update.release_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("update.banner.view_release")}
          </a>
        )}
        <button
          type="button"
          className="update-banner-close"
          onClick={onDismiss}
          aria-label={t("update.banner.dismiss")}
        >
          ×
        </button>
      </span>
    </div>
  );
}
