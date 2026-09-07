import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { WorkspaceService } from "../src/services/workspace";
import { CodexService } from "../src/services/codex/service";
import type { Platform, AiRun } from "../src/contracts/model";
const root = path.resolve(".local/codex-verification");
const workspace = new WorkspaceService(path.join(root, "app-data"));
const codex = new CodexService(workspace, (e) => {
  if (e.type === "run-status") console.log(JSON.stringify(e));
});
const events: unknown[] = [];
try {
  const brand = await workspace.open(path.join(root, "brand"));
  const founder = await workspace.open(path.join(root, "founder"));
  const fixtures = [
    "demo-1.png",
    "demo-2.png",
    "demo-3.png",
    "demo-h264.mp4",
  ].map((f) => path.resolve("tests/fixtures", f));
  for (const w of [brand, founder])
    await workspace.importAssets(w.project.id, fixtures, "copy");
  const connected = await codex.connect();
  if (connected.state !== "ready") throw new Error(connected.message);
  codex.connection!.on("notification", (m: any) => {
    if (
      ![
        "item/agentMessage/delta",
        "item/started",
        "item/completed",
        "turn/started",
        "turn/completed",
      ].includes(m.method)
    )
      return;
    const p = m.params;
    const sample: any = {
      method: m.method,
      params: { threadId: "thread-demo" },
    };
    if (p.turnId) sample.params.turnId = "turn-demo";
    if (p.delta) sample.params.delta = p.delta;
    if (p.item && ["agentMessage", "userMessage"].includes(p.item.type))
      sample.params.item = {
        id: "item-demo",
        type: p.item.type,
        ...(p.item.type === "agentMessage" ? { text: p.item.text } : {}),
      };
    if (p.turn) sample.params.turn = { id: "turn-demo", status: p.turn.status };
    events.push(sample);
  });
  const content = brand.contents[0];
  const assets = workspace.load(brand.project.id).assets;
  const runs: AiRun[] = [];
  for (const [platform, locale] of [
    ["x", "en"],
    ["instagram", "en"],
    ["xiaohongshu", "zh-CN"],
  ] as [Platform, string][]) {
    const c = workspace.addVariant(
      brand.project.id,
      content.id,
      platform,
      locale,
    );
    const v = c.variants.at(-1)!;
    workspace.saveVariant(brand.project.id, c.id, {
      variant: {
        ...v,
        assetIds: assets.filter((a) => a.kind === "image").map((a) => a.id),
        coverId: assets.find((a) => a.kind === "image")!.id,
      },
      baseRevision: v.revision,
      baseHash: v.bodyHash,
    });
    runs.push(
      codex.start({
        projectId: brand.project.id,
        contentId: c.id,
        variantId: v.id,
        prompt: `将已确认的素材导入测试事实，写为适合 ${platform} 的 ${locale === "en" ? "英文" : "中文"} 短草稿。80 字以内，附件仅是演示色块，不从图像编造事实。明确是演示，不用工具。`,
      }),
    );
  }
  // Access the other identity while the brand tasks run; results must retain origin IDs.
  workspace.load(founder.project.id);
  const deadline = Date.now() + 12 * 60000;
  while (codex.active || codex.queue.length) {
    if (Date.now() > deadline) throw new Error("generation timeout");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const verifiedRuns = workspace
    .load(brand.project.id)
    .runs.filter((r) => runs.some((run) => run.id === r.id));
  if (verifiedRuns.some((r) => r.status !== "applied"))
    throw new Error(
      JSON.stringify(
        verifiedRuns.map((r) => ({ status: r.status, error: r.error })),
      ),
    );
  const current = workspace.getContent(brand.project.id, content.id);
  let wechat = current.variants.find((v) => v.platform === "wechat")!;
  const saved = workspace.saveVariant(brand.project.id, current.id, {
    variant: {
      ...wechat,
      assetIds: assets
        .filter((a) => a.kind === "image")
        .slice(0, 2)
        .map((a) => a.id),
      coverId: assets.find((a) => a.kind === "image")!.id,
      segments: [
        { type: "text", text: wechat.body },
        { type: "image", assetId: assets.find((a) => a.kind === "image")!.id },
        { type: "text", text: "以上为本地验收演示，没有向真实群聊发送。" },
      ],
    },
    baseRevision: wechat.revision,
    baseHash: wechat.bodyHash,
  });
  wechat = saved.variants.find((v) => v.platform === "wechat")!;
  workspace.saveVariant(brand.project.id, current.id, {
    variant: { ...wechat, readiness: "ready" },
    baseRevision: wechat.revision,
    baseHash: wechat.bodyHash,
  });
  let w = workspace.addAccount(brand.project.id, {
    platform: "wechat",
    label: "演示运营身份",
    externalId: "",
    accountType: "operator",
  });
  const account = w.accounts.at(-1)!;
  for (const label of ["演示共创一群", "演示共创二群"])
    w = workspace.addTarget(brand.project.id, {
      accountId: account.id,
      label,
      kind: "group",
    });
  const jobs = await workspace.schedule(brand.project.id, {
    contentId: current.id,
    variantId: wechat.id,
    targetIds: w.targets
      .filter((t) => t.accountId === account.id)
      .map((t) => t.id),
    scheduledAtUtc: new Date(Date.now() + 24 * 3600000).toISOString(),
    timezone: "Asia/Shanghai",
  });
  for (const j of jobs) workspace.exportJob(brand.project.id, j.id);
  workspace.recordManual(brand.project.id, jobs[0].id, {
    recordedBy: "验收演示（模拟人工回填）",
    recordedAt: new Date().toISOString(),
    result: "仅验证状态持久化，未真实发送",
    url: "",
    completedSegments: [0, 1, 2],
  });
  const x = workspace
    .getContent(brand.project.id, current.id)
    .variants.find((v) => v.id === runs[0].variantId)!;
  workspace.saveVariant(brand.project.id, current.id, {
    variant: { ...x, readiness: "ready" },
    baseRevision: x.revision,
    baseHash: x.bodyHash,
  });
  w = workspace.addAccount(brand.project.id, {
    platform: "x",
    label: "演示 X 官号",
    externalId: "",
    accountType: "profile",
  });
  w = workspace.addTarget(brand.project.id, {
    accountId: w.accounts.at(-1)!.id,
    label: "演示 X 主页",
    kind: "profile",
  });
  await workspace.schedule(brand.project.id, {
    contentId: current.id,
    variantId: x.id,
    targetIds: [w.targets.at(-1)!.id],
    scheduledAtUtc: new Date(Date.now() + 48 * 3600000).toISOString(),
    timezone: "Asia/Shanghai",
  });
  const report = {
    verifiedAt: new Date().toISOString(),
    version: connected.version,
    realGenerations: verifiedRuns.map((r) => ({
      platform: workspace
        .getContent(brand.project.id, current.id)
        .variants.find((v) => v.id === r.variantId)!.platform,
      status: r.status,
      output: JSON.parse(r.output),
    })),
    jobs: workspace
      .load(brand.project.id)
      .jobs.map((j) => ({ status: j.status, target: j.targetLabel })),
    crossProjectIsolation: true,
  };
  writeFileSync(
    ".local/first-loop-report.json",
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    "tests/fixtures/codex-events.jsonl",
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const demoRoot = path.resolve("../演示项目");
  mkdirSync(demoRoot, { recursive: true });
  for (const w of [brand, founder]) {
    const destination = path.join(demoRoot, w.project.name);
    workspace.backup(w.project.id, destination, true);
  }
  console.log(JSON.stringify({ result: "complete", demoRoot, report }));
} finally {
  codex.close();
  workspace.closeAll();
}
