import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import {
  getPlatformDefinition,
  type Variant,
  type Workspace,
} from "../contracts/model";
import {
  coverCheckedAt,
  coverModeLabels,
  coverRuleFor,
  coverRules,
  effectiveCoverId,
  selectCover,
} from "../contracts/covers";
import { AssetPreview } from "./AssetPreview";

export function CoverEditor({
  w,
  draft,
  change,
  refresh,
  notice,
}: {
  w: Workspace;
  draft: Variant;
  change: (patch: Partial<Variant>) => void;
  refresh: () => Promise<unknown>;
  notice: (message: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const definition = getPlatformDefinition(w.platforms, draft.platform);
  const rule = coverRuleFor(draft, definition, w.assets);
  const id = effectiveCoverId(draft, definition, w.assets);
  const asset = w.assets.find((a) => a.id === id);
  const selectable = ["first_media", "independent", "review"].includes(
    rule.mode,
  );
  const first = rule.mode === "first_media";
  const latest = useRef({ draft, rule, change });
  latest.current = { draft, rule, change };
  const choose = (assetId: string) => {
    const state = latest.current;
    state.change(selectCover(state.draft, state.rule, assetId));
    setPicking(false);
  };
  const importCover = async () => {
    setBusy(true);
    try {
      const result = await window.workbench.call<
        { status: string; assetId?: string; message?: string }[]
      >("assets.import", {
        projectId: w.project.id,
        mode: "copy",
        imagesOnly: true,
      });
      if (!active.current) return;
      const imported = result.find(
        (r) => r.assetId && ["imported", "reused"].includes(r.status),
      );
      if (imported?.assetId) choose(imported.assetId);
      else if (result.length)
        notice(result[0].message || "请选择 JPEG、PNG 或 WebP 图片");
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const images = w.assets.filter(
    (a) =>
      a.kind === "image" &&
      a.availability === "available" &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      className="cover-editor"
      aria-label="封面管理"
      data-cover-mode={rule.mode}
    >
      <div className="section-heading">
        <h2>封面管理</h2>
        <span className="state">{coverModeLabels[rule.mode]}</span>
      </div>
      <p className="cover-rule-summary">{rule.summary}</p>
      {selectable && (
        <div className="cover-selection">
          <div className="cover-thumbnail">
            {asset ? (
              <AssetPreview
                projectId={w.project.id}
                asset={asset}
                alt="当前封面"
              />
            ) : (
              <ImagePlus size={30} />
            )}
          </div>
          <div className="cover-selection-info">
            <strong>
              {asset?.name ||
                (first
                  ? "尚无正文首图"
                  : rule.mode === "review"
                    ? "尚未准备候选封面"
                    : "尚未设置独立封面")}
            </strong>
            {asset && asset.availability !== "available" && (
              <p className="error">封面源文件不可用或已变化，请重新导入。</p>
            )}
            <small>
              {first
                ? "选择的图片会成为正文第一张，读者也会在内容中看到它。"
                : "单独导入的封面不会加入正文，也不会改写原视频。"}
            </small>
            <div className="button-row">
              <button
                type="button"
                className="secondary small-button"
                disabled={busy || w.project.readOnly}
                onClick={() => void importCover()}
              >
                <Upload size={14} />
                {busy ? "正在导入…" : first ? "导入首图" : "导入封面"}
              </button>
              <button
                type="button"
                className="secondary small-button"
                disabled={busy || w.project.readOnly}
                onClick={() => setPicking(!picking)}
              >
                从素材库选择{first ? "首图" : "封面"}
              </button>
              {!first && draft.coverId && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || w.project.readOnly}
                  onClick={() => change({ coverId: null })}
                >
                  <X size={13} />
                  清除封面
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {picking && selectable && (
        <div className="cover-picker">
          <label>
            查找封面图片
            <input
              aria-label="查找封面图片"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="asset-picker">
            {images.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`asset-pick ${a.id === id ? "selected" : ""}`}
                aria-label={`选作${first ? "首图" : "封面"} ${a.name}`}
                onClick={() => choose(a.id)}
              >
                <AssetPreview projectId={w.project.id} asset={a} alt={a.name} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
          {!images.length && (
            <p className="hint">
              没有可用图片，可直接导入。视频可先在素材库中截取关键帧。
            </p>
          )}
        </div>
      )}
      <p className="hint">{rule.note}</p>
      {draft.coverId && id !== draft.coverId && (
        <p className="hint">
          此前的独立封面仍已保留，当前类型不使用它。
          <button
            type="button"
            className="text-button"
            disabled={w.project.readOnly}
            onClick={() => change({ coverId: null })}
          >
            清除保留的封面
          </button>
        </p>
      )}
      <details className="cover-rules">
        <summary>查看封面规格与各平台差异 · {coverCheckedAt}</summary>
        <p>{rule.sizing}</p>
        <p className="hint">
          可单独制作的图片仍应准确反映内容。以下为公开资料和本地准备方式；实际上传入口、账号资格及裁切需在平台检查。
        </p>
        <div className="cover-rules-table">
          <table>
            <thead>
              <tr>
                <th>平台 / 类型</th>
                <th>封面与内容关系</th>
                <th>说明与来源</th>
              </tr>
            </thead>
            <tbody>
              {coverRules.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.platform}
                    <br />
                    <small>{r.format}</small>
                  </td>
                  <td>{coverModeLabels[r.mode]}</td>
                  <td>
                    {r.summary}
                    {r.source && (
                      <>
                        {" "}
                        <a
                          href={r.source}
                          onClick={(e) => {
                            e.preventDefault();
                            void window.workbench
                              .call("covers.source", { key: r.key })
                              .catch((e) => notice((e as Error).message));
                          }}
                        >
                          官方资料
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
