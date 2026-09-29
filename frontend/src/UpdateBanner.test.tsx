import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UpdateBanner from "./UpdateBanner";
import type { UpdateCheck, UpdateInstall } from "./api";

const available: UpdateCheck = {
  status: "ok",
  current_version: "0.22.3-beta",
  latest_version: "0.23.0-beta",
  update_available: true,
  channel: "beta",
  release_url: "https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/v0.23.0-beta",
  checked_at: "2026-09-25T00:00:00Z",
  assets: [],
};

const install: UpdateInstall = {
  job_id: "job-1",
  status: "queued",
  version: "0.23.0-beta",
  current_version: "0.22.3-beta",
  message: "queued",
  started_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
};

function renderBanner(
  update: UpdateCheck | null = available,
  currentInstall: UpdateInstall | null = null,
  dismissed = false,
) {
  const onStart = vi.fn();
  const onCancel = vi.fn();
  const onDismiss = vi.fn();
  return {
    onStart,
    onCancel,
    onDismiss,
    ...render(
      <UpdateBanner
        update={update}
        install={currentInstall}
        dismissed={dismissed}
        onDismiss={onDismiss}
        onStart={onStart}
        onCancel={onCancel}
      />,
    ),
  };
}

describe("UpdateBanner", () => {
  it("requires an explicit click before downloading an update", async () => {
    const user = userEvent.setup();
    const { onStart } = renderBanner();
    await user.click(screen.getByRole("button", { name: "更新" }));
    expect(onStart).toHaveBeenCalledWith("0.23.0-beta");
  });

  it("shows progress and allows cancellation during download", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderBanner(
      available,
      { ...install, status: "downloading", message: "正在下载安装包" },
    );
    expect(screen.getByText("正在下载")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消更新" }));
    expect(onCancel).toHaveBeenCalledWith("job-1");
  });

  it("requires a user-initiated restart after verification and staging", () => {
    renderBanner(available, { ...install, status: "ready", message: "ready" });
    expect(screen.getByText("0.23.0-beta 已准备完成")).toBeInTheDocument();
    expect(
      screen.getByText("重启 Varen CAD 后生效。当前版本仍可继续使用，应用不会自动重启。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
  });

  it("allows cancellation after the update is ready", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderBanner(available, { ...install, status: "ready", message: "ready" });
    await user.click(screen.getByRole("button", { name: "\u53d6\u6d88\u66f4\u65b0" }));
    expect(onCancel).toHaveBeenCalledWith("job-1");
  });

  it("keeps the current version visible when verification fails", () => {
    renderBanner(
      available,
      { ...install, status: "failed", message: "checksum mismatch", error_code: "hash_mismatch" },
    );
    expect(screen.getByText("更新未安装")).toBeInTheDocument();
    expect(screen.getByText("checksum mismatch")).toBeInTheDocument();
    expect(screen.getByText("当前版本保持不变。")).toBeInTheDocument();
  });

  it("renders nothing when no update is available and no job exists", () => {
    const { container } = renderBanner({ ...available, update_available: false });
    expect(container.firstChild).toBeNull();
  });

  it("dismisses on close", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderBanner();
    await user.click(screen.getByRole("button", { name: "关闭更新提示" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
