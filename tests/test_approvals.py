"""ApprovalBroker 单测：request 阻塞 / resolve 三种动作 / 超时 / 过期。"""

from __future__ import annotations

import threading
import time
import unittest

from backend.agent.approvals import ApprovalBroker


class ApprovalBrokerTests(unittest.TestCase):
    def test_approve_returns_original_args(self) -> None:
        broker = ApprovalBroker(timeout=5)
        result = {}

        def requester() -> None:
            result["decision"] = broker.request(
                kind="destructive_op", op="delete_feature",
                args={"feature_id": "F_0001"}, message="可删吗？",
            )

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        resolved = broker.resolve(result_approval_id(broker), "approve")
        t.join(timeout=2)
        self.assertEqual(resolved["action"], "approve")
        self.assertEqual(resolved["args"], {"feature_id": "F_0001"})
        self.assertEqual(result["decision"]["action"], "approve")

    def test_edit_overrides_args(self) -> None:
        broker = ApprovalBroker(timeout=5)
        result = {}

        def requester() -> None:
            result["decision"] = broker.request(
                kind="destructive_fix", op="extrude",
                args={"depth": 10, "mode": "cut"}, message="改参？",
            )

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        resolved = broker.resolve(result_approval_id(broker), "edit", {"depth": 8, "mode": "cut"})
        t.join(timeout=2)
        self.assertEqual(resolved["action"], "edit")
        self.assertEqual(resolved["args"], {"depth": 8, "mode": "cut"})
        self.assertEqual(result["decision"]["args"], {"depth": 8, "mode": "cut"})

    def test_reject(self) -> None:
        broker = ApprovalBroker(timeout=5)
        result = {}

        def requester() -> None:
            result["decision"] = broker.request(
                kind="ask_user", op="ask_user", args={"question": "q"}, message="q",
            )

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        resolved = broker.resolve(result_approval_id(broker), "reject")
        t.join(timeout=2)
        self.assertEqual(resolved["action"], "reject")
        self.assertEqual(result["decision"]["action"], "reject")

    def test_timeout_returns_timeout_action(self) -> None:
        broker = ApprovalBroker(timeout=0.2)
        started = time.time()
        decision = broker.request(kind="ask_user", op="ask_user", args={}, message="无人答")
        self.assertEqual(decision["action"], "timeout")
        self.assertGreaterEqual(time.time() - started, 0.1)

    def test_cancel_all_wakes_pending_wait_with_cancelled(self) -> None:
        broker = ApprovalBroker(timeout=30)
        result: dict = {}

        def requester() -> None:
            result["decision"] = broker.request(kind="destructive_op", op="delete_feature", args={}, message="m")

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        cancelled = broker.cancel_all("会话已结束")
        t.join(timeout=2)
        self.assertEqual(cancelled, 1)
        self.assertFalse(t.is_alive(), "cancel_all 必须立即唤醒阻塞的 wait")
        self.assertEqual(result["decision"]["action"], "cancelled")

    def test_resolve_after_cancel_raises_keyerror(self) -> None:
        broker = ApprovalBroker(timeout=5)
        request = broker.create(kind="ask_user", op="ask_user", args={}, message="m")
        broker.cancel_all()
        with self.assertRaises(KeyError):
            broker.resolve(request.approval_id, "approve")
        started = time.time()
        decision = broker.wait(request)  # 事件已置位：不得再阻塞 5s
        self.assertEqual(decision["action"], "cancelled")
        self.assertLess(time.time() - started, 1.0)

    def test_cancel_all_on_empty_returns_zero(self) -> None:
        self.assertEqual(ApprovalBroker(timeout=5).cancel_all(), 0)

    def test_resolve_unknown_id_raises(self) -> None:
        broker = ApprovalBroker(timeout=5)
        with self.assertRaises(KeyError):
            broker.resolve("approval-nonexistent", "approve")

    def test_resolve_invalid_action_raises(self) -> None:
        broker = ApprovalBroker(timeout=5)
        result = {}

        def requester() -> None:
            result["decision"] = broker.request(kind="ask_user", op="ask_user", args={}, message="m")

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        with self.assertRaises(ValueError):
            broker.resolve(result_approval_id(broker), "bogus")
        broker.resolve(result_approval_id(broker), "reject")  # 清理
        t.join(timeout=2)

    def test_edit_without_override_raises(self) -> None:
        broker = ApprovalBroker(timeout=5)
        result = {}

        def requester() -> None:
            result["decision"] = broker.request(kind="ask_user", op="ask_user", args={}, message="m")

        t = threading.Thread(target=requester)
        t.start()
        time.sleep(0.2)
        aid = result_approval_id(broker)
        with self.assertRaises(ValueError):
            broker.resolve(aid, "edit")
        broker.resolve(aid, "reject")  # 清理
        t.join(timeout=2)


def result_approval_id(broker: ApprovalBroker) -> str:
    """从 broker 内部取当前待审批 id（供测试模拟用户答复）。"""
    import os

    with broker._lock:
        return next(iter(broker._requests))


if __name__ == "__main__":
    unittest.main()
