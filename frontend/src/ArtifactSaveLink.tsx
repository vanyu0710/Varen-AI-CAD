import { useState, type ReactNode } from "react";
import { saveArtifactAs } from "./api";
import { useT } from "./i18n";

type Props = {
  url?: string;
  filename?: string;
  children: ReactNode;
  className?: string;
};

export default function ArtifactSaveLink({ url, filename, children, className }: Props) {
  const t = useT();
  const [error, setError] = useState("");

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!url || !filename || typeof (window as any).showSaveFilePicker !== "function") {
      // Keep the native <a download> behavior for browsers without Save As.
      return;
    }
    event.preventDefault();
    setError("");
    try {
      await saveArtifactAs(url, filename);
    } catch (err) {
      setError(t("task.export.save_failed", { message: String((err as Error)?.message || err) }));
    }
  }

  return (
    <>
      <a
        className={className || (url ? "" : "disabled")}
        href={url || undefined}
        download={filename || undefined}
        onClick={url ? handleClick : undefined}
      >
        {children}
      </a>
      {error && (
        <span className="artifact-save-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
