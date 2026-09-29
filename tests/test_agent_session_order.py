import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from backend.agent.approvals import ApprovalBroker
from backend.agent.loop import AgentLoop
from backend.agent.session import SessionRegistry, normalize_agent_messages
from backend.mechcad_ai.client import ToolCall, ToolCallRound


class _Worker:
    def capabilities(self):
        return {"public": []}


def _ask_user_round():
    call = ToolCall(id="call-order-1", name="ask_user", arguments={
        "questions": [{"id": "q1", "question": "直径？", "type": "text"}]
    })
    return ToolCallRound(
        text="",
        tool_calls=[call],
        raw_message={
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": call.id, "type": "function", "function": {"name": call.name, "arguments": "{}"}}],
        },
    )


class AgentMessageOrderTests(unittest.TestCase):
    def test_ask_user_pending_interjection_stays_after_tool_result(self):
        with tempfile.TemporaryDirectory() as td:
            from backend.agent.session import AgentSession

            session = AgentSession(project_id="p-order", path=Path(td) / "session.json")
            session.append({"role": "user", "content": "开始"})
            broker = ApprovalBroker(timeout=5)

            def chat(messages, tools):
                if not any(m.get("role") == "tool" for m in messages):
                    # 模拟真实场景：assistant 发出 ask_user 后、审批返回前用户插话。
                    session.enqueue_user("继续")
                    return _ask_user_round()
                return ToolCallRound(text="完成", tool_calls=[])

            def resolve():
                time.sleep(0.05)
                with broker._lock:
                    approval_id = next(iter(broker._requests))
                broker.resolve(approval_id, "approve", {"answers": {"q1": "12mm"}})

            resolver = threading.Thread(target=resolve)
            resolver.start()
            loop = AgentLoop(
                worker=_Worker(),
                chat_with_tools=chat,
                protocol="openai",
                emit=lambda *_: None,
                run_dir=Path(td),
                system_prompt="test",
                session=session,
                approvals=broker,
                max_steps=4,
            )
            result = loop.run()
            resolver.join(timeout=2)
            self.assertFalse(result.ok)  # 无几何交付时保持硬门控；本测试只验证消息顺序。
            self.assertEqual(result.error_kind, "NO_GEOMETRY")

            messages = session.llm_messages()
            call_index = next(i for i, m in enumerate(messages) if m.get("tool_calls"))
            tool_index = next(i for i, m in enumerate(messages) if m.get("tool_call_id") == "call-order-1")
            interjection_index = next(i for i, m in enumerate(messages) if m.get("role") == "user" and m.get("content") == "继续")
            self.assertLess(call_index, tool_index)
            self.assertLess(tool_index, interjection_index)
            self.assertEqual(messages[call_index + 1]["role"], "tool")

    def test_registry_repairs_legacy_tool_result_order_and_saves(self):
        bad = [
            {"role": "user", "content": "继续"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": "call-legacy", "type": "function", "function": {"name": "ask_user", "arguments": "{}"}}],
            },
            {"role": "user", "content": "插话"},
            {"role": "tool", "tool_call_id": "call-legacy", "content": "{}"},
        ]
        normalized = normalize_agent_messages(bad)
        self.assertEqual([m["role"] for m in normalized], ["user", "assistant", "tool", "user"])
        self.assertEqual(normalized[2]["tool_call_id"], "call-legacy")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "legacy.json").write_text(json.dumps({
                "project_id": "legacy",
                "status": "idle",
                "messages": bad,
                "pending": [],
                "plan": {},
                "parts_library": {},
            }, ensure_ascii=False), encoding="utf-8")
            session = SessionRegistry(root).get("legacy")
            self.assertEqual([m["role"] for m in session.messages], ["user", "assistant", "tool", "user"])
            saved = json.loads((root / "legacy.json").read_text(encoding="utf-8"))
            self.assertEqual([m["role"] for m in saved["messages"]], ["user", "assistant", "tool", "user"])

    def test_missing_tool_result_gets_explicit_placeholder(self):
        bad = [{
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": "call-missing", "type": "function", "function": {"name": "measure", "arguments": "{}"}}],
        }]
        normalized = normalize_agent_messages(bad)
        self.assertEqual([m["role"] for m in normalized], ["assistant", "tool"])
        self.assertIn("结果缺失", normalized[1]["content"])


if __name__ == "__main__":
    unittest.main()
