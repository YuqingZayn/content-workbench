import React, { createContext, useContext, useId, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  defaultPlatforms,
  getPlatformDefinition,
  platformDetailsSchema,
  composerModes,
  composerNames,
  type ComposerMode,
  type PlatformDefinition,
  type Workspace,
} from "../contracts/model";

const PlatformContext = createContext({
  items: defaultPlatforms,
  readOnly: true,
  save: async (_input: {
    id?: string;
    name: string;
    color: string;
    composer?: ComposerMode;
  }): Promise<PlatformDefinition> => {
    throw new Error("请先打开项目");
  },
});

export function PlatformProvider({
  workspace,
  refresh,
  children,
}: {
  workspace: Workspace | null;
  refresh: () => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <PlatformContext.Provider
      value={{
        items: workspace?.platforms ?? defaultPlatforms,
        readOnly: !workspace || workspace.project.readOnly,
        save: async (input) => {
          if (!workspace) throw new Error("请先打开项目");
          const saved = await window.workbench.call<PlatformDefinition>(
            "platforms.save",
            {
              projectId: workspace.project.id,
              ...input,
            },
          );
          await refresh();
          return saved;
        },
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatforms() {
  const context = useContext(PlatformContext);
  return {
    ...context,
    getPlatform: (id: string) => getPlatformDefinition(context.items, id),
  };
}

function PlatformEditor({
  platform,
  onSaved,
  onCancel,
}: {
  platform?: PlatformDefinition;
  onSaved: (platform: PlatformDefinition) => void;
  onCancel: () => void;
}) {
  const { save, readOnly } = usePlatforms();
  const [name, setName] = useState(platform?.name ?? "");
  const [color, setColor] = useState(platform?.color ?? "#628877");
  const [composer, setComposer] = useState<ComposerMode>(
    platform?.composer ?? "post",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving || readOnly) return;
    const parsed = platformDetailsSchema.safeParse({ name, color, composer });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      onSaved(await save({ id: platform?.id, ...parsed.data }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="platform-editor"
      role="group"
      aria-label={platform ? "编辑平台" : "新增平台"}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <h3>{platform ? "编辑平台" : "新增平台"}</h3>
      <div className="platform-fields">
        <label>
          平台名称
          <input
            value={name}
            maxLength={60}
            disabled={saving || readOnly}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：知乎、企业微信"
          />
        </label>
        <label>
          标识颜色
          <input
            type="color"
            value={color}
            disabled={saving || readOnly}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
      </div>
      <label>
        编辑方式
        <select
          aria-label="编辑方式"
          value={composer}
          disabled={saving || readOnly}
          onChange={(e) => setComposer(e.target.value as ComposerMode)}
        >
          {composerModes.map((mode) => (
            <option key={mode} value={mode}>
              {composerNames[mode]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        仅用于当前项目。编辑方式会同步用于已有版本，已保存的字段会保留。
      </p>
      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={saving || readOnly || !name.trim()}
          onClick={() => void submit()}
        >
          {saving ? "正在保存…" : "保存平台"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={saving}
          onClick={onCancel}
        >
          取消编辑
        </button>
      </div>
    </div>
  );
}

export function PlatformPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { items, readOnly } = usePlatforms();
  const [editing, setEditing] = useState<PlatformDefinition | "new" | null>(
    null,
  );
  const selectId = useId();
  const selected = items.find((p) => p.id === value);
  return (
    <div className="platform-picker">
      <label htmlFor={selectId}>平台</label>
      <select
        id={selectId}
        value={value}
        disabled={readOnly || editing !== null}
        onChange={(e) => onChange(e.target.value)}
      >
        {!selected && <option value={value}>{value || "请选择平台"}</option>}
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="platform-picker-actions">
        <button
          type="button"
          className="text-button"
          disabled={readOnly || editing !== null}
          onClick={() => setEditing("new")}
        >
          <Plus size={14} />
          新增平台
        </button>
        <button
          type="button"
          className="text-button"
          disabled={readOnly || !selected || editing !== null}
          onClick={() => setEditing(selected!)}
        >
          <Pencil size={14} />
          编辑当前平台
        </button>
      </div>
      {editing && (
        <PlatformEditor
          platform={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(p) => {
            onChange(p.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

export function PlatformManager() {
  const { items, readOnly } = usePlatforms();
  const [editing, setEditing] = useState<PlatformDefinition | "new" | null>(
    null,
  );
  return (
    <section className="card platform-manager" aria-label="平台管理">
      <div className="section-heading">
        <div>
          <h2>平台管理</h2>
          <p className="hint">
            为当前项目添加平台，设置名称、颜色和对应的编辑方式。
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={readOnly || editing !== null}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} />
          新增平台
        </button>
      </div>
      {editing && (
        <PlatformEditor
          key={editing === "new" ? "new" : editing.id}
          platform={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      <div className="platform-management-grid">
        {items.map((p) => (
          <div className="platform-management-item" key={p.id}>
            <span
              className="platform-color-dot"
              style={{ background: p.color }}
            />
            <span>
              {p.name}
              <small className="hint">{composerNames[p.composer]}</small>
            </span>
            <button
              type="button"
              className="icon"
              aria-label={`编辑${p.name}`}
              disabled={readOnly || editing !== null}
              onClick={() => setEditing(p)}
            >
              <Pencil size={15} />
            </button>
          </div>
        ))}
      </div>
      <p className="hint">
        所有平台均使用人工辅助发布：准备文案与素材、导出发布包、记录发布结果。
      </p>
    </section>
  );
}
