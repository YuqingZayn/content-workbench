import type {
  AdapterContext,
  PublisherAdapter,
  SnapshotInput,
} from "./adapter";
import { PublishError } from "./adapter";
import type { Prepared, PublishResult } from "../../contracts/automation";
export class MockAdapter implements PublisherAdapter {
  async check(c: AdapterContext) {
    return {
      remoteId: c.connection.remoteId || "simulation",
      message: "模拟连接，仅在本机运行，不发送内容",
    };
  }
  async validate(input: SnapshotInput) {
    if (input.account.accountType !== "mock")
      throw new PublishError("模拟连接只能绑定专用模拟账号，不能使用真实账号");
  }
  async prepare(input: SnapshotInput, c: AdapterContext, previous: Prepared) {
    if (c.connection.scenario === "upload_failure")
      throw new PublishError("模拟：上传失败，尚未提交", true);
    if (c.connection.scenario === "auth_expired")
      throw new PublishError("模拟：授权失效", false, true);
    const p = { ...previous, containerId: `mock-${input.job.id}` };
    c.persistPrepared(p);
    return p;
  }
  async submit(
    input: SnapshotInput,
    c: AdapterContext,
  ): Promise<PublishResult> {
    if (c.connection.scenario === "submit_timeout")
      throw new PublishError(
        "模拟：最终提交超时，平台可能已创建",
        false,
        false,
        undefined,
        true,
      );
    if (
      c.connection.scenario === "rate_limit" &&
      input.job.execution!.attempt === 1
    )
      throw new PublishError("模拟：429 限流，明确未发送", true, false, 90000);
    if (c.connection.scenario === "rejected")
      return {
        state: "not_sent",
        message: "模拟：内容被拒绝",
        retryable: false,
      };
    if (c.connection.scenario === "processing")
      return {
        state: "processing",
        id: `mock-${input.job.id}`,
        message: "模拟：平台处理中",
      };
    return {
      state: "published",
      id: `mock-${input.job.id}`,
      message: "模拟成功，未向任何平台发送",
    };
  }
  async reconcile(
    input: SnapshotInput,
    c: AdapterContext,
  ): Promise<PublishResult> {
    if (c.connection.scenario === "submit_timeout")
      return { state: "unknown", message: "模拟：无法核实，禁止自动再次提交" };
    return {
      state: "published",
      id: `mock-${input.job.id}`,
      message: "模拟核实成功",
    };
  }
}
