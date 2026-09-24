import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import UpdateBanner from "./UpdateBanner";
import type { UpdateCheck } from "./api";

const available: UpdateCheck = {
  status: "ok",
  current_version: "0.22.2-beta",
  latest_version: "0.23.0-beta",
  update_available: true,
  channel: "beta",
  release_url: "https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/v0.23.0-beta",
  checked_at: "2026-09-24T00:00:00Z",
  assets: [],
};

function renderBanner(update: UpdateCheck | null = available, dismissed = false, onDismiss = vi.fn()) {
  return { onDismiss, ...render(<UpdateBanner update={update} dismissed={dismissed} onDismiss={onDismiss} />) };
}

describe("UpdateBanner", () => {
  it("shows the latest and current versions with a release link", () => {
    renderBanner();
    expect(screen.getByText("发现新版本 0.23.0-beta")).toBeInTheDocument();
    expect(screen.getByText("当前版本 0.22.2-beta")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "查看发布页" });
    expect(link).toHaveAttribute("href", available.release_url);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("dismisses on close", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderBanner();
    await user.click(screen.getByRole("button", { name: "关闭更新提示" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no update is available", () => {
    const { container } = renderBanner({ ...available, update_available: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the check is degraded", () => {
    const { container } = renderBanner({ ...available, status: "unavailable" });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing after dismissal", () => {
    const { container } = renderBanner(available, true);
    expect(container.firstChild).toBeNull();
  });
});
