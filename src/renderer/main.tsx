import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FolderOpen,
  Plus,
  LayoutDashboard,
  Files,
  Image as ImageIcon,
  CalendarDays,
  Send,
  Users,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Check,
  Clock,
  Search,
  X,
  Download,
  Folder,
  Play,
  Sparkles,
  Copy,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Link,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Scissors,
  Camera,
  ArrowRight,
  Sun,
} from "lucide-react";
import {
  getPlatformDefinition,
  type Workspace,
  type ProjectView,
  type Content,
  type Variant,
  type Asset,
  type Job,
  type CodexStatus,
  type CodexView,
  type Platform,
  type Account,
  type Target,
  type ThemePreference,
} from "../contracts/model";
import "./style.css";
import { AssetPreview } from "./AssetPreview";
import {
  composerFor,
  defaultPublishing,
  publicationSegments,
  publicationFormat,
  nativePlatform,
  splitMessages,
} from "../contracts/publishing";
import { PublishingFields, PublishingSummary } from "./PublishingFields";
import {
  PlatformFields,
  PlatformPreview,
  composerHeadings,
} from "./PlatformComposer";
import {
  PlatformProvider,
  PlatformPicker,
  PlatformManager,
  usePlatforms,
} from "./Platforms";
import {
  ConnectionsPanel,
  BackgroundPanel,
  JobAutomationActions,
  publishStatus,
} from "./Automation";
import { WebLoginPanel } from "./WebLogin";
const api = window.workbench;
const statusName: Record<string, string> = {
  ...publishStatus,
  scheduled: "已排期",
  manual_pending: "待人工发布",
  partial: "部分完成",
  completed: "已完成",
  paused: "已暂停",
  cancelled: "已取消",
  queued: "排队中",
  running: "生成中",
  stopping: "正在停止",
  applied: "已应用到草稿",
  suggestion: "建议待合并",
  invalid: "输出未应用",
  interrupted: "已中断",
  failed: "失败",
};
const mediaUrl = (projectId: string, a: Asset) =>
  `media://asset/${projectId}/${a.id}?revision=${a.sha256}`;
const localInput = (date = new Date()) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const formatTime = (iso: string, tz = "Asia/Shanghai") =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  }).format(new Date(iso));
const initials = (name: string) => name.trim().slice(0, 1) || "项";
function Badge({ platform }: { platform: Platform }) {
  const { getPlatform } = usePlatforms();
  const definition = getPlatform(platform);
  return (
    <span
      className="platform-badge"
      style={{ "--platform": definition.color } as React.CSSProperties}
    >
      {definition.name}
    </span>
  );
}
function Empty({
  icon: Icon = Files,
  title,
  text,
  action,
}: {
  icon?: typeof Files;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      "input,button,textarea,select",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button,input,textarea,select,[tabindex="0"]',
          ),
        ].filter((e) => !e.hasAttribute("disabled"));
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭对话框" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [recent, setRecent] = useState<ProjectView[]>([]),
    [w, setW] = useState<Workspace | null>(null),
    [page, setPage] = useState("dashboard"),
    [theme, setTheme] = useState<ThemePreference>("light"),
    [contentId, setContentId] = useState(""),
    [search, setSearch] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [newTitle, setNewTitle] = useState<string | null>(null),
    [showProjects, setShowProjects] = useState(false),
    [assistant, setAssistant] = useState(true),
    [codex, setCodex] = useState<CodexStatus>({
      state: "disconnected",
      message: "尚未连接",
      version: "",
      models: [],
    }),
    [progress, setProgress] = useState("");
  const wRef = useRef(w),
    guard = useRef<() => Promise<boolean>>(async () => true);
  wRef.current = w;
  const notice = (message: string) => setToast(message);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setBusy(true);
      return await fn();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const id = wRef.current?.project.id;
    if (!id) return;
    const next = await api.call<Workspace>("project.load", { projectId: id });
    if (wRef.current?.project.id === id) setW(next);
  };
  useEffect(() => {
    void api
      .call<{
        recent: ProjectView[];
        codex: CodexStatus;
        settings: { theme: ThemePreference };
      }>("app.bootstrap")
      .then((r) => {
        setRecent(r.recent);
        setCodex(r.codex);
        setTheme(r.settings.theme);
      })
      .catch((e) => notice(e.message));
    return api.onEvent((e) => {
      if (e.type === "codex-status")
        void api.call<CodexStatus>("codex.status").then(setCodex);
      if (
        ["run-status", "workspace-changed"].includes(e.type) &&
        e.projectId === wRef.current?.project.id
      )
        void refresh();
      if (e.type === "import-progress") setProgress(e.message ?? "");
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const navigate = async (next: string, id?: string) => {
    if (!(await guard.current())) return;
    setPage(next);
    if (id !== undefined) setContentId(id);
    setSearch("");
  };
  const openProject = async (p?: string) => {
    if (!(await guard.current())) return;
    await run(async () => {
      const next = await api.call<Workspace | null>(
        "project.open",
        p ? { path: p } : {},
      );
      if (next) {
        setW(next);
        setRecent(
          (await api.call<{ recent: ProjectView[] }>("app.bootstrap")).recent,
        );
        setPage("dashboard");
        setContentId("");
        setShowProjects(false);
        setProgress("");
      }
    });
  };
  const create = async () => {
    if (newTitle === null || !w) return;
    await run(async () => {
      const c = await api.call<Content>("content.create", {
        projectId: w.project.id,
        title: newTitle,
      });
      setNewTitle(null);
      await refresh();
      await navigate("editor", c.id);
    });
  };
  const nav = [
    { id: "dashboard", label: "工作台", icon: LayoutDashboard },
    { id: "contents", label: "内容库", icon: Files },
    { id: "assets", label: "素材库", icon: ImageIcon },
    { id: "calendar", label: "发布日历", icon: CalendarDays },
    { id: "records", label: "发布记录", icon: Send },
    { id: "accounts", label: "账号与定位", icon: Users },
  ];
  const pending =
    w?.jobs.filter(
      (j) => !["completed", "published", "cancelled"].includes(j.status),
    ) ?? [];
  const content = w?.contents.find((c) => c.id === contentId);
  const view = (
    <div className={`app ${w ? "" : "welcome-app"}`} aria-busy={busy}>
      <aside className="sidebar">
        <div className="wordmark">
          <div className="brand-icon">
            <Files size={21} />
          </div>
          <div>
            内容工作台<small>CONTENT WORKBENCH</small>
          </div>
        </div>
        <button
          className="project-switch"
          onClick={() => setShowProjects(!showProjects)}
        >
          <div
            className={`avatar ${w?.project.identityType === "founder" ? "founder" : ""}`}
          >
            {w ? initials(w.project.name) : <Folder size={18} />}
          </div>
          <span>
            {w?.project.name ?? "选择账号项目"}
            <small>
              {w
                ? w.project.identityType === "founder"
                  ? "创始人 IP"
                  : "品牌官号"
                : "从本地文件夹开始"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        {showProjects && (
          <div className="project-menu">
            {recent.map((p) => (
              <button key={p.id} onClick={() => void openProject(p.root)}>
                <span className="avatar small">{initials(p.name)}</span>
                <span>
                  {p.name}
                  <small>{p.root}</small>
                </span>
              </button>
            ))}
            <button onClick={() => void openProject()}>
              <Plus size={16} />
              打开其他文件夹
            </button>
          </div>
        )}
        <span className="nav-caption">工作空间</span>
        <nav>
          {nav.map((n) => (
            <button
              disabled={!w}
              key={n.id}
              className={
                page === n.id || (n.id === "contents" && page === "editor")
                  ? "active"
                  : ""
              }
              onClick={() => void navigate(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "calendar" && pending.length > 0 && (
                <em>{pending.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="dot" />
            <span>
              本地优先<small>文件和素材由你掌握</small>
            </span>
          </div>
          <button
            disabled={!w}
            className={page === "settings" ? "active" : ""}
            onClick={() => void navigate("settings")}
          >
            <Settings size={18} />
            设置与备份
          </button>
          <div className="version">v0.2 · DEV</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {w?.project.name ?? "欢迎使用"}
            <ChevronRight size={14} />
            <strong>
              {page === "editor"
                ? "内容编辑"
                : (nav.find((n) => n.id === page)?.label ?? "设置与备份")}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="dot" />
              本地工作空间
            </span>
            {w && (
              <button
                className="icon"
                aria-label="打开项目文件夹"
                onClick={() =>
                  void run(() =>
                    api.call("project.reveal", { projectId: w.project.id }),
                  )
                }
              >
                <FolderOpen size={18} />
              </button>
            )}
            {w && (
              <button
                className="icon"
                aria-label="切换 Codex 面板"
                aria-expanded={assistant}
                onClick={() => setAssistant(!assistant)}
              >
                {assistant ? (
                  <PanelRightClose size={18} />
                ) : (
                  <PanelRightOpen size={18} />
                )}
              </button>
            )}
          </div>
        </header>
        {w?.project.readOnly && (
          <div className="warning-banner">
            {w.project.warning ?? "此项目只读"} · 可浏览，无法保存
          </div>
        )}
        {!w ? (
          <main className="welcome">
            <div className="eyebrow">YOUR CONTENT, YOUR SPACE</div>
            <h1>
              让好内容，
              <br />
              <span>有条不紊地发生。</span>
            </h1>
            <p>
              官号与创始人 IP，各有自己的工作空间。
              <br />
              从一份素材开始，走到每个平台的发布记录。
            </p>
            <button
              className="primary large"
              onClick={() => void openProject()}
            >
              <FolderOpen size={19} />
              打开本地文件夹
            </button>
            <small className="hint">
              可选择已有素材目录，或在选择器中新建空文件夹。
            </small>
            <div className="welcome-features">
              <span>
                <Folder size={17} />
                普通文件夹
              </span>
              <span>
                <Sparkles size={17} />
                本机 Codex
              </span>
              <span>
                <Send size={17} />9 个平台辅助发布
              </span>
            </div>
            {recent.length > 0 && (
              <section className="recent-projects">
                <h3>最近项目</h3>
                {recent.map((p) => (
                  <button key={p.id} onClick={() => void openProject(p.root)}>
                    <div className="avatar">{initials(p.name)}</div>
                    <span>
                      {p.name}
                      <small>{p.root}</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </section>
            )}
          </main>
        ) : (
          <div
            className={`workbench-layout ${assistant ? "" : "no-assistant"}`}
          >
            {page === "editor" && content ? (
              <Editor
                key={w.project.id + content.id}
                w={w}
                content={content}
                refresh={refresh}
                notice={notice}
                guard={guard}
                onBack={() => void navigate("contents")}
              />
            ) : (
              <main className="main-scroll">
                {page === "dashboard" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">工作台 / OVERVIEW</div>
                        <h1>把想法，变成下一条内容。</h1>
                        <p>这里是 {w.project.name} 的内容工作空间。</p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => setNewTitle("")}
                      >
                        <Plus size={17} />
                        新建内容
                      </button>
                    </div>
                    <div className="stats">
                      <div>
                        <span>内容主题</span>
                        <strong>
                          {w.contents.length}
                          <small>篇</small>
                        </strong>
                        <Files size={21} />
                      </div>
                      <div>
                        <span>可用素材</span>
                        <strong>
                          {
                            w.assets.filter(
                              (a) => a.availability === "available",
                            ).length
                          }
                          <small>份</small>
                        </strong>
                        <ImageIcon size={21} />
                      </div>
                      <div>
                        <span>待完成发布</span>
                        <strong>
                          {pending.length}
                          <small>项</small>
                        </strong>
                        <Clock size={21} />
                      </div>
                      <div>
                        <span>已完成发布</span>
                        <strong>
                          {
                            w.jobs.filter((j) =>
                              ["completed", "published"].includes(j.status),
                            ).length
                          }
                          <small>项</small>
                        </strong>
                        <CheckCircle2 size={21} />
                      </div>
                    </div>
                    <div className="dashboard-columns">
                      <section className="card">
                        <div className="section-heading">
                          <h2>
                            最近内容 <span>RECENT CONTENT</span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => void navigate("contents")}
                          >
                            查看全部 <ArrowRight size={14} />
                          </button>
                        </div>
                        {w.contents.length ? (
                          w.contents
                            .slice(0, 5)
                            .map((c) => (
                              <ContentRow
                                key={c.id}
                                c={c}
                                w={w}
                                onOpen={() => void navigate("editor", c.id)}
                              />
                            ))
                        ) : (
                          <Empty
                            title="第一条内容，从这里开始"
                            text="创建主题，整理事实，再写出各平台的表达。"
                            action={
                              <button
                                className="secondary"
                                onClick={() => setNewTitle("")}
                              >
                                <Plus size={16} />
                                创建内容主题
                              </button>
                            }
                          />
                        )}
                      </section>
                      <section className="card">
                        <div className="section-heading">
                          <h2>
                            接下来发布 <span>UP NEXT</span>
                          </h2>
                        </div>
                        {pending.length ? (
                          pending.slice(0, 4).map((j) => (
                            <button
                              className="upcoming"
                              key={j.id}
                              onClick={() => void navigate("records")}
                            >
                              <span className="date-tile">
                                {new Date(j.scheduledAtUtc).getDate()}
                                <small>
                                  {new Date(j.scheduledAtUtc).getMonth() + 1}月
                                </small>
                              </span>
                              <span>
                                <strong>{j.title}</strong>
                                <small>
                                  {j.targetLabel} ·{" "}
                                  {formatTime(j.scheduledAtUtc, j.timezone)}
                                </small>
                                <Badge platform={j.platform} />
                              </span>
                            </button>
                          ))
                        ) : (
                          <Empty
                            icon={CalendarDays}
                            title="还没有发布安排"
                            text="草稿就绪后，为每个目标安排人工截止时间。"
                          />
                        )}
                      </section>
                    </div>
                    <section className="journey">
                      <div className="journey-mark">
                        <Sparkles size={23} />
                      </div>
                      <div>
                        <h3>从素材到发布，留下一条完整记录</h3>
                        <p>
                          素材导入 <span>→</span> 平台草稿 <span>→</span>{" "}
                          排期与发布包 <span>→</span> 人工回填
                        </p>
                      </div>
                      <span className="pill">所有内容保存在本地</span>
                    </section>
                  </>
                )}
                {page === "contents" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">CONTENT LIBRARY</div>
                        <h1>
                          内容库{" "}
                          <span className="count">{w.contents.length}</span>
                        </h1>
                        <p>一个主题，延展成各个平台的表达。</p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => setNewTitle("")}
                      >
                        <Plus size={17} />
                        新建内容
                      </button>
                    </div>
                    <div className="toolbar">
                      <div className="search">
                        <Search size={16} />
                        <input
                          placeholder="搜索标题或正文"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <span className="muted">独立版本 · 本地保存</span>
                    </div>
                    <div className="card">
                      {w.contents
                        .filter((c) =>
                          (c.title + c.variants.map((v) => v.body).join(""))
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((c) => (
                          <ContentRow
                            key={c.id}
                            c={c}
                            w={w}
                            onOpen={() => void navigate("editor", c.id)}
                          />
                        ))}
                      {!w.contents.length && (
                        <Empty
                          title="还没有内容主题"
                          text="选题、事实底稿和平台版本会集中保存在这里。"
                        />
                      )}
                    </div>
                  </>
                )}
                {page === "assets" && (
                  <Assets
                    w={w}
                    refresh={refresh}
                    notice={notice}
                    progress={progress}
                  />
                )}
                {page === "accounts" && (
                  <Accounts w={w} refresh={refresh} notice={notice} />
                )}
                {page === "calendar" && (
                  <Calendar
                    w={w}
                    refresh={refresh}
                    notice={notice}
                    onRecords={() => void navigate("records")}
                  />
                )}
                {page === "records" && (
                  <Records w={w} refresh={refresh} notice={notice} />
                )}
                {page === "settings" && (
                  <SettingsPage
                    w={w}
                    theme={theme}
                    setTheme={setTheme}
                    codex={codex}
                    setCodex={setCodex}
                    notice={notice}
                    onRestore={(next) => {
                      setW(next);
                      setPage("dashboard");
                    }}
                  />
                )}
              </main>
            )}
            <Assistant
              key={w.project.id}
              w={w}
              page={page as CodexView["page"]}
              viewingContent={page === "editor" ? content : undefined}
              hidden={!assistant}
              codex={codex}
              setCodex={setCodex}
              refresh={refresh}
              guard={guard}
              notice={notice}
            />
          </div>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={18} />
          {toast}
          <button
            aria-label="关闭提示"
            className="icon"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && <div className="busy-line" />}
      {newTitle !== null && (
        <Modal title="新建内容主题" onClose={() => setNewTitle(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              主题名称
              <input
                autoFocus
                required
                placeholder="例如：一个值得分享的项目进展"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <p className="hint">先确定一个主题，再添加不同平台和语言版本。</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setNewTitle(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                创建主题
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
  return (
    <PlatformProvider workspace={w} refresh={refresh}>
      {view}
    </PlatformProvider>
  );
}
function ContentRow({
  c,
  w,
  onOpen,
}: {
  c: Content;
  w: Workspace;
  onOpen: () => void;
}) {
  const v = c.variants[0];
  const a = w.assets.find((a) => a.id === (v?.coverId ?? v?.assetIds[0]));
  return (
    <button className="content-row" onClick={onOpen}>
      <div className="content-thumb">
        {a?.kind === "image" ? (
          <AssetPreview projectId={w.project.id} asset={a} />
        ) : (
          <Files size={22} />
        )}
      </div>
      <div className="content-summary">
        <h3>{c.title}</h3>
        <p>
          {c.variants.length} 个平台版本 <span>·</span>{" "}
          {new Date(c.updatedAt).toLocaleDateString("zh-CN")}
        </p>
        <div className="badges">
          {[...new Set(c.variants.map((v) => v.platform))].map((p) => (
            <Badge key={p} platform={p} />
          ))}
        </div>
      </div>
      <span className={`state ${v?.readiness === "ready" ? "green" : ""}`}>
        {v?.readiness === "ready" ? "已就绪" : "草稿"}
      </span>
      <ChevronRight size={16} />
    </button>
  );
}
type Common = {
  w: Workspace;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
};
function Editor({
  w,
  content,
  refresh,
  notice,
  guard,
  onBack,
}: Common & {
  content: Content;
  guard: React.MutableRefObject<() => Promise<boolean>>;
  onBack: () => void;
}) {
  const [vid, setVid] = useState(content.variants[0]?.id ?? ""),
    [draft, setDraft] = useState<Variant | null>(content.variants[0] ?? null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [brief, setBrief] = useState(content.brief),
    [audience, setAudience] = useState(content.audience),
    [objective, setObjective] = useState(content.objective),
    [add, setAdd] = useState(false),
    [platform, setPlatform] = useState<Platform>("xiaohongshu"),
    [locale, setLocale] = useState("zh-CN"),
    [selectAssets, setSelectAssets] = useState(false),
    [schedule, setSchedule] = useState(false),
    [history, setHistory] = useState<Content[] | null>(null),
    [conflict, setConflict] = useState<any>(null);
  const current = content.variants.find((v) => v.id === vid);
  const ref = useRef({ draft, dirty, current, brief, audience, objective });
  ref.current = { draft, dirty, current, brief, audience, objective };
  useEffect(() => {
    if (!dirty && current) {
      setDraft(current);
      setBrief(content.brief);
      setAudience(content.audience);
      setObjective(content.objective);
    }
    if (!vid && content.variants.length) {
      setVid(content.variants[0].id);
      setDraft(content.variants[0]);
    }
  }, [content]);
  async function save(ready?: boolean) {
    const state = ref.current;
    if (!state.draft) return true;
    if (!state.dirty && ready === undefined) return true;
    setSaving(true);
    try {
      const next = await api.call<Content>("content.save", {
        projectId: w.project.id,
        contentId: content.id,
        variant: {
          ...state.draft,
          readiness: ready ? "ready" : state.draft.readiness,
        },
        baseRevision: state.draft.revision,
        baseHash: state.draft.bodyHash ?? "",
        brief: state.brief,
        audience: state.audience,
        objective: state.objective,
      });
      setDraft(next.variants.find((v) => v.id === vid) ?? null);
      setDirty(false);
      await refresh();
      if (
        ready &&
        next.variants.find((v) => v.id === vid)?.readiness !== "ready"
      )
        notice("修改已保存，请再次标记就绪以确认新版本");
      return true;
    } catch (e) {
      if ((e as any).code === "REVISION_CONFLICT")
        setConflict((e as any).details);
      notice((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    guard.current = () => save();
    return () => {
      guard.current = async () => true;
    };
  }, [vid, content, w.project.id]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (ref.current.dirty) {
        e.preventDefault();
        e.returnValue = "草稿尚未保存";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const change = (patch: Partial<Variant>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch, readiness: "draft" });
    setDirty(true);
  };
  const changeVariant = async (id: string) => {
    if (await save()) {
      setVid(id);
      setDraft(content.variants.find((v) => v.id === id) ?? null);
    }
  };
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notice((e as Error).message);
    }
  };
  const composer = draft
    ? composerFor(draft, getPlatformDefinition(w.platforms, draft.platform))
    : "post";
  const effectiveSegments = draft
    ? publicationSegments(
        draft,
        getPlatformDefinition(w.platforms, draft.platform),
        w.assets,
      )
    : [];
  const activeFormat = draft
    ? publicationFormat(
        draft,
        getPlatformDefinition(w.platforms, draft.platform),
      )
    : undefined;
  const isStory =
    draft &&
    nativePlatform(getPlatformDefinition(w.platforms, draft.platform)) ===
      "instagram" &&
    (draft.publishing ?? defaultPublishing()).instagram.format === "story";
  const bindings =
    draft?.assetIds
      .map((id) => w.assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a) ?? [];
  const reorder = (index: number, direction: number) => {
    if (!draft) return;
    const ids = [...draft.assetIds];
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    change({ assetIds: ids });
  };
  return (
    <div className="editor-main">
      <div className="editor-heading">
        <button className="text-button" onClick={onBack}>
          <ChevronLeft size={15} />
          内容库
        </button>
        <div className={`save-state ${dirty ? "unsaved" : ""}`}>
          <span className="dot" />
          {saving ? "保存中" : dirty ? "有未保存修改" : "已保存到本地"}
        </div>
      </div>
      <div className="editor-title">
        <h1>{content.title}</h1>
        <p>内容主题 / {content.variants.length} 个独立版本</p>
      </div>
      <div className="variant-tabs">
        {content.variants.map((v) => (
          <button
            key={v.id}
            className={v.id === vid ? "selected" : ""}
            onClick={() => void changeVariant(v.id)}
          >
            <span
              style={{
                background: getPlatformDefinition(w.platforms, v.platform)
                  .color,
              }}
              className="platform-dot"
            />
            {getPlatformDefinition(w.platforms, v.platform).name}
            <small>{v.locale.startsWith("en") ? "EN" : "中文"}</small>
          </button>
        ))}
        <button className="add-variant" onClick={() => setAdd(true)}>
          <Plus size={16} />
          添加版本
        </button>
      </div>
      {!draft ? (
        <Empty
          icon={Files}
          title="为主题添加第一个平台版本"
          text="每个平台的语言、正文和媒体顺序独立保存。"
          action={
            <button className="primary" onClick={() => setAdd(true)}>
              <Plus size={16} />
              添加版本
            </button>
          }
        />
      ) : (
        <div className="editor-scroll">
          <details className="brief-panel">
            <summary>
              事实底稿与内容目标 <span>为 AI 提供可靠的上下文</span>
            </summary>
            <div className="two-col">
              <label>
                目标受众
                <input
                  value={audience}
                  onChange={(e) => {
                    setAudience(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                目标行动
                <input
                  value={objective}
                  onChange={(e) => {
                    setObjective(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </div>
            <label>
              事实底稿
              <textarea
                rows={4}
                value={brief}
                onChange={(e) => {
                  setBrief(e.target.value);
                  setDirty(true);
                }}
                placeholder="只填已经确认的事实、数据或个人观察"
              />
            </label>
          </details>
          <div className="compose-grid" data-composer={composer}>
            <div className="compose-fields">
              <div className="section-heading">
                <h2>
                  {activeFormat
                    ? `${getPlatformDefinition(w.platforms, draft.platform).name} · ${activeFormat.label}`
                    : composerHeadings[composer]}
                </h2>
                <span
                  className={`state ${draft.readiness === "ready" ? "green" : ""}`}
                >
                  {draft.readiness === "ready" ? "已就绪" : "草稿"} · r
                  {draft.revision}
                </span>
              </div>
              <PublishingFields w={w} draft={draft} change={change} />
              <PlatformFields w={w} draft={draft} change={change} />
              <div className="compose-media">
                <div className="section-heading media-heading">
                  <h2>
                    {composer === "note"
                      ? "笔记图片与封面"
                      : composer === "article"
                        ? "文章封面与配图"
                        : composer === "video" || composer === "short_video"
                          ? "视频与封面"
                          : "关联素材"}{" "}
                    <span>{bindings.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => setSelectAssets(true)}
                  >
                    <Plus size={15} />
                    选择素材
                  </button>
                </div>
                <div className="bindings">
                  {bindings.map((a, i) => (
                    <div className="binding" key={a.id}>
                      <div className="binding-thumb">
                        {a.kind === "image" ? (
                          <AssetPreview
                            projectId={w.project.id}
                            asset={a}
                            alt={a.name}
                          />
                        ) : (
                          <Play size={18} />
                        )}
                      </div>
                      <div>
                        <strong>{a.name}</strong>
                        <small>
                          {i + 1} · {a.kind === "image" ? "图片" : "视频"}
                          {draft.coverId === a.id ? " · 封面" : ""}
                        </small>
                      </div>
                      <div className="binding-actions">
                        <button
                          className="icon"
                          disabled={i === 0}
                          aria-label={`上移素材 ${i + 1}`}
                          onClick={() => reorder(i, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="icon"
                          disabled={i === bindings.length - 1}
                          aria-label={`下移素材 ${i + 1}`}
                          onClick={() => reorder(i, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        {a.kind === "image" &&
                          !isStory &&
                          !["post", "chat"].includes(composer) && (
                            <button
                              className="icon"
                              title="设为封面"
                              aria-label={`设置封面 ${i + 1}`}
                              onClick={() =>
                                change({
                                  coverId: a.id,
                                  ...(["note", "photo"].includes(composer)
                                    ? {
                                        assetIds: [
                                          a.id,
                                          ...draft.assetIds.filter(
                                            (id) => id !== a.id,
                                          ),
                                        ],
                                      }
                                    : {}),
                                })
                              }
                            >
                              <ImageIcon size={14} />
                            </button>
                          )}
                        <button
                          className="icon"
                          aria-label={`移除关联 ${i + 1}`}
                          onClick={() =>
                            change({
                              assetIds: draft.assetIds.filter(
                                (id) => id !== a.id,
                              ),
                              coverId:
                                draft.coverId === a.id ? null : draft.coverId,
                            })
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!bindings.length && (
                    <button
                      className="asset-empty"
                      onClick={() => setSelectAssets(true)}
                    >
                      <ImageIcon size={23} />
                      选择图片、视频或关键帧
                    </button>
                  )}
                </div>
              </div>
              {(composer === "chat" || draft.segments.length > 0) && (
                <div className="segments">
                  <div className="section-heading">
                    <h2>
                      {draft.platform === "wechat"
                        ? "群消息顺序"
                        : composer === "chat"
                          ? "频道消息顺序"
                          : "已有消息段"}
                    </h2>
                    <span className="muted">
                      {draft.segments.length || "自动"} 段
                    </span>
                  </div>
                  <p className="hint">
                    {draft.segments.length
                      ? "当前按下方消息段发布；上方正文作为写作底稿，修改底稿不会覆盖这些消息段。"
                      : "未自定义时，按正文、关联素材顺序生成。"}
                    已发送的每一段可独立记录。
                  </p>
                  {draft.segments.map((s, i) => (
                    <div className="segment" key={i}>
                      <span className="segment-index">{i + 1}</span>
                      <div>
                        {s.type === "text" ? (
                          <textarea
                            aria-label={`第 ${i + 1} 段文字`}
                            rows={2}
                            value={s.text}
                            onChange={(e) =>
                              change({
                                segments: draft.segments.map((x, n) =>
                                  n === i
                                    ? { type: "text", text: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                        ) : s.type === "link" ? (
                          <input
                            aria-label={`第 ${i + 1} 段链接`}
                            value={s.url}
                            onChange={(e) =>
                              change({
                                segments: draft.segments.map((x, n) =>
                                  n === i
                                    ? {
                                        type: "link",
                                        url: e.target.value,
                                        label: "链接",
                                      }
                                    : x,
                                ),
                              })
                            }
                          />
                        ) : (
                          <span>
                            {s.type === "image" ? "图片" : "视频"} ·{" "}
                            {w.assets.find((a) => a.id === s.assetId)?.name}
                          </span>
                        )}
                      </div>
                      {(s.type === "text" || s.type === "link") && (
                        <button
                          className="icon"
                          aria-label={`复制消息段 ${i + 1}`}
                          onClick={() =>
                            void call(async () => {
                              await api.call("clipboard.copy", {
                                text:
                                  s.type === "text"
                                    ? s.text
                                    : [s.label, s.url]
                                        .filter(Boolean)
                                        .join("\n"),
                              });
                              notice(`已复制第 ${i + 1} 段`);
                            })
                          }
                        >
                          <Copy size={13} />
                        </button>
                      )}
                      <button
                        className="icon"
                        disabled={i === 0}
                        aria-label={`上移消息段 ${i + 1}`}
                        onClick={() => {
                          const segments = [...draft.segments];
                          [segments[i - 1], segments[i]] = [
                            segments[i],
                            segments[i - 1],
                          ];
                          change({ segments });
                        }}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="icon"
                        aria-label={`删除消息段 ${i + 1}`}
                        onClick={() =>
                          change({
                            segments: draft.segments.filter((_, n) => i !== n),
                          })
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="button-row">
                    <button
                      className="secondary small-button"
                      disabled={draft.segments.length > 0 || !draft.body.trim()}
                      onClick={() =>
                        change({
                          segments: splitMessages(
                            draft,
                            getPlatformDefinition(w.platforms, draft.platform),
                            w.assets,
                          ),
                        })
                      }
                    >
                      按空行拆分正文
                    </button>
                    <button
                      className="secondary small-button"
                      onClick={() =>
                        change({
                          segments: [
                            ...effectiveSegments,
                            { type: "text", text: "" },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      文字段
                    </button>
                    <button
                      className="secondary small-button"
                      onClick={() =>
                        change({
                          segments: [
                            ...effectiveSegments,
                            { type: "link", url: "https://", label: "链接" },
                          ],
                        })
                      }
                    >
                      <Link size={14} />
                      链接
                    </button>
                    <button
                      className="secondary small-button"
                      disabled={!bindings.length}
                      onClick={() =>
                        change({
                          segments: [
                            ...effectiveSegments,
                            ...bindings
                              .filter(
                                (a) =>
                                  !effectiveSegments.some(
                                    (s) => "assetId" in s && s.assetId === a.id,
                                  ),
                              )
                              .map((a) => ({
                                type: a.kind,
                                assetId: a.id,
                              })),
                          ],
                        })
                      }
                    >
                      加入已选媒体
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="preview-column">
              <div className="preview-label">
                <span>内容预览</span>
                <Badge platform={draft.platform} />
              </div>
              <PlatformPreview
                key={draft.id}
                w={w}
                draft={draft}
                bindings={bindings}
              />
              <PublishingSummary w={w} draft={draft} />
              <p className="hint centered">平台最终排版以实际客户端为准</p>
              <div className="preview-guidance">
                <CheckCircle2 size={16} />
                <p>发布安排会固定当前文案与媒体。后续编辑会保留原任务快照。</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {draft && (
        <div className="editor-footer">
          <button
            className="text-button"
            onClick={() =>
              void call(async () =>
                setHistory(
                  await api.call<Content[]>("content.histories", {
                    projectId: w.project.id,
                    contentId: content.id,
                    variantId: vid,
                  }),
                ),
              )
            }
          >
            <Clock size={16} />
            版本历史
          </button>
          <div className="button-row">
            <button
              className="secondary"
              disabled={saving || w.project.readOnly}
              onClick={() => void save()}
            >
              <Check size={16} />
              保存草稿
            </button>
            <button
              className="secondary"
              disabled={saving || w.project.readOnly}
              onClick={() => void save(true)}
            >
              标记就绪
            </button>
            <button
              className="primary"
              disabled={
                dirty || draft.readiness !== "ready" || w.project.readOnly
              }
              onClick={() => setSchedule(true)}
            >
              <CalendarDays size={16} />
              安排发布
            </button>
          </div>
        </div>
      )}
      {add && (
        <Modal title="添加平台版本" onClose={() => setAdd(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void call(async () => {
                if (!(await save())) return;
                const c = await api.call<Content>("content.addVariant", {
                  projectId: w.project.id,
                  contentId: content.id,
                  platform,
                  locale,
                });
                setVid(c.variants.at(-1)!.id);
                setDraft(c.variants.at(-1)!);
                setDirty(false);
                setAdd(false);
                await refresh();
              });
            }}
          >
            <PlatformPicker value={platform} onChange={setPlatform} />
            <label>
              语言
              <select
                value={locale}
                aria-label="语言"
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="modal-actions">
              <button className="primary">添加版本</button>
            </div>
          </form>
        </Modal>
      )}
      {selectAssets && draft && (
        <Modal wide title="关联项目素材" onClose={() => setSelectAssets(false)}>
          <div className="asset-picker">
            {w.assets
              .filter((a) => a.availability === "available")
              .map((a) => (
                <button
                  key={a.id}
                  className={`asset-pick ${draft.assetIds.includes(a.id) ? "selected" : ""}`}
                  onClick={() =>
                    change({
                      assetIds: draft.assetIds.includes(a.id)
                        ? draft.assetIds.filter((id) => id !== a.id)
                        : [...draft.assetIds, a.id],
                    })
                  }
                >
                  {a.kind === "image" ? (
                    <AssetPreview
                      projectId={w.project.id}
                      asset={a}
                      alt={a.name}
                    />
                  ) : (
                    <div className="video-tile">
                      <Play size={28} />
                    </div>
                  )}
                  <span>{a.name}</span>
                  {draft.assetIds.includes(a.id) && (
                    <em>
                      <Check size={14} />
                    </em>
                  )}
                </button>
              ))}
          </div>
          {!w.assets.length && (
            <Empty
              icon={ImageIcon}
              title="素材库还空着"
              text="先到素材库导入图片或视频，再关联到此版本。"
            />
          )}
          <div className="modal-actions">
            <button className="primary" onClick={() => setSelectAssets(false)}>
              完成选择
            </button>
          </div>
        </Modal>
      )}
      {schedule && draft && (
        <ScheduleModal
          w={w}
          content={content}
          variant={draft}
          onClose={() => setSchedule(false)}
          onDone={async () => {
            setSchedule(false);
            await refresh();
            notice("已创建逐目标任务，可在发布记录中导出和回填");
          }}
          notice={notice}
        />
      )}
      {history && draft && (
        <Modal
          wide
          title="版本历史 · 恢复为新草稿"
          onClose={() => setHistory(null)}
        >
          {history.map((c, i) => {
            const v = c.variants.find((v) => v.id === vid);
            return (
              v && (
                <div className="history" key={i}>
                  <div>
                    <strong>r{v.revision}</strong>
                    <span>{new Date(c.updatedAt).toLocaleString()}</span>
                    <button
                      className="secondary"
                      onClick={() => {
                        change({
                          title: v.title,
                          body: v.body,
                          tags: v.tags,
                          article: v.article ?? {
                            author: "",
                            digest: "",
                            sourceUrl: "",
                          },
                          publishing: v.publishing ?? defaultPublishing(),
                          assetIds: v.assetIds,
                          coverId: v.coverId,
                          segments: v.segments,
                        });
                        setHistory(null);
                      }}
                    >
                      恢复到编辑器
                    </button>
                  </div>
                  <pre>{v.body}</pre>
                </div>
              )
            );
          })}
          {!history.length && <p>保存修改后，旧版本会出现在这里。</p>}
        </Modal>
      )}
      {conflict && (
        <Modal
          wide
          title="修改冲突 · 两份内容均已保留"
          onClose={() => setConflict(null)}
        >
          <div className="two-col">
            <div>
              <h3>磁盘当前内容</h3>
              <pre className="diff">{conflict.current.body}</pre>
            </div>
            <div>
              <h3>你的未提交内容</h3>
              <pre className="diff">{conflict.proposed.body}</pre>
            </div>
          </div>
          <p className="hint">
            加载当前版本后，可将需要保留的段落合并到正文再保存。
          </p>
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => {
                void api.call("clipboard.copy", {
                  text: conflict.proposed.body,
                });
                notice("已复制你的未提交内容");
              }}
            >
              复制未提交内容
            </button>
            <button
              className="primary"
              onClick={() =>
                void call(async () => {
                  setDirty(false);
                  setDraft(conflict.current);
                  setConflict(null);
                  await refresh();
                })
              }
            >
              加载磁盘版本
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ScheduleModal({
  w,
  content,
  variant,
  onClose,
  onDone,
  notice,
}: {
  w: Workspace;
  content: Content;
  variant: Variant;
  onClose: () => void;
  onDone: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [date, setDate] = useState(localInput()),
    [publishMode, setPublishMode] = useState<
      "manual_due" | "automatic" | "simulation"
    >("manual_due"),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false);
  const accounts = w.accounts.filter(
    (a) => a.platform === variant.platform && a.enabled,
  );
  const targets = w.targets.filter(
    (t) => t.enabled && accounts.some((a) => a.id === t.accountId),
  );
  return (
    <Modal title="安排辅助发布" onClose={onClose}>
      <label>
        发布方式
        <select
          aria-label="发布方式"
          value={publishMode}
          onChange={(e) => {
            setPublishMode(e.target.value as typeof publishMode);
            setApproved(false);
          }}
        >
          <option value="manual_due">人工辅助发布</option>
          <option value="simulation">本地模拟（专用模拟目标）</option>
          <option value="automatic">自动发布（已检查连接的目标）</option>
        </select>
      </label>
      <div className="snapshot-note">
        <Badge platform={variant.platform} />
        <strong>{variant.title}</strong>
        <small>将固定 r{variant.revision} 的正文与媒体</small>
      </div>
      <label>
        {publishMode === "manual_due" ? "人工截止时间" : "计划执行时间"}
        （本机时区：
        {Intl.DateTimeFormat().resolvedOptions().timeZone}）
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <p className="hint">
        记录为 UTC，按项目时区 {w.project.timezone} 展示。
        {publishMode === "manual_due"
          ? "到期后由你人工发布。"
          : "开发版运行时自动处理；错过 5 分钟需重新安排。"}
      </p>
      {publishMode !== "manual_due" && (
        <label className="check-row">
          <input
            aria-label="确认自动发布"
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          {publishMode === "simulation"
            ? "确认执行本地模拟，不发送到平台"
            : "确认在上述时间向所选真实目标发送当前固定内容"}
        </label>
      )}
      <label>发布目标</label>
      <div className="target-list">
        {targets.map((t) => (
          <label key={t.id} className="check-row">
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, t.id]
                    : selected.filter((id) => id !== t.id),
                )
              }
            />
            <span>
              {t.label}
              <small>{accounts.find((a) => a.id === t.accountId)?.label}</small>
            </span>
          </label>
        ))}
      </div>
      {!targets.length && (
        <p className="warning-text">
          请先在“账号与定位”登记此平台的发送账号及目标。
        </p>
      )}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={
            !selected.length ||
            busy ||
            (publishMode !== "manual_due" && !approved)
          }
          onClick={() => {
            setBusy(true);
            void api
              .call("publish.schedule", {
                mode: publishMode,
                approved,
                projectId: w.project.id,
                contentId: content.id,
                variantId: variant.id,
                targetIds: selected,
                scheduledAtUtc: new Date(date).toISOString(),
                timezone: w.project.timezone,
              })
              .then(onDone)
              .catch((e) => notice(e.message))
              .finally(() => setBusy(false));
          }}
        >
          创建 {selected.length} 个目标任务
        </button>
      </div>
    </Modal>
  );
}
function Assistant({
  w,
  page,
  viewingContent,
  hidden,
  codex,
  setCodex,
  refresh,
  guard,
  notice,
}: Common & {
  page: CodexView["page"];
  viewingContent?: Content;
  hidden: boolean;
  codex: CodexStatus;
  setCodex: (s: CodexStatus) => void;
  guard: React.MutableRefObject<() => Promise<boolean>>;
}) {
  const [scopeId, setScopeId] = useState(""),
    [prompts, setPrompts] = useState<Record<string, string>>({}),
    [mode, setMode] = useState<"task" | "draft">("task"),
    [model, setModel] = useState(
      () => localStorage.getItem("codex-model") ?? "",
    ),
    [effort, setEffort] = useState(
      () => localStorage.getItem("codex-effort") ?? "",
    ),
    [variantId, setVariantId] = useState(""),
    [live, setLive] = useState<Record<string, string>>({}),
    [activity, setActivity] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const content = w.contents.find((c) => c.id === scopeId);
  const scroll = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const prompt = prompts[scopeId] ?? "";
  const setPrompt = (value: string) =>
    setPrompts((old) => ({ ...old, [scopeId]: value }));
  const pageNames: Record<CodexView["page"], string> = {
    dashboard: "工作台 · 选题策划",
    contents: "内容库",
    editor: "内容编辑",
    assets: "素材整理",
    calendar: "发布排期",
    records: "发布复盘",
    accounts: "账号与定位",
    settings: "设置与备份",
  };
  const suggestions: Record<CodexView["page"], string[]> = {
    dashboard: [
      "结合账号定位，帮我策划 5 个选题",
      "根据现有素材，建议下一条内容",
      "帮我安排本周内容计划",
    ],
    contents: [
      "梳理现有选题，建议优先做哪些",
      "检查内容是否重复，找出可以延展的角度",
    ],
    editor: ["帮我理清当前内容的核心观点", "根据事实底稿检查表达与逻辑"],
    assets: [
      "根据素材库，推荐适合的选题方向",
      "帮我梳理现有素材，还需要补充什么",
    ],
    calendar: ["检查发布安排，建议合适的内容节奏", "帮我规划下一周的发布计划"],
    records: [
      "根据已有发布记录做复盘，不编造数据",
      "梳理尚未完成的发布，建议下一步",
    ],
    accounts: ["帮我梳理账号定位和目标受众", "为各个平台建议适合的内容方向"],
    settings: ["帮我检查本地工作流程是否完整", "解释如何备份和恢复这个项目"],
  };
  const selectedModel = codex.models.find(
    (m) => m.id === (model || codex.defaultModel),
  );
  const effortOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const validEffort = effortOptions.some((e) => e.reasoningEffort === effort)
    ? effort
    : "";
  const defaultEffort = effortOptions.some(
    (e) => e.reasoningEffort === codex.defaultReasoningEffort,
  )
    ? codex.defaultReasoningEffort
    : selectedModel?.defaultReasoningEffort;
  const effortLabels: Record<string, string> = {
    none: "无",
    minimal: "最低",
    low: "低",
    medium: "中等",
    high: "高",
    xhigh: "超高",
    max: "最大",
    ultra: "极高",
  };
  useEffect(() => {
    if (codex.state !== "ready") return;
    if (model && !codex.models.some((m) => m.id === model)) {
      setModel("");
      return;
    }
    localStorage.setItem("codex-model", model);
    localStorage.setItem("codex-effort", validEffort);
    if (codex.state === "ready" && effort !== validEffort)
      setEffort(validEffort);
  }, [model, effort, validEffort, codex.state, codex.models]);
  const runs = w.runs.filter((r) => (r.contentId ?? "") === scopeId),
    active = runs.find((r) =>
      ["running", "queued", "stopping"].includes(r.status),
    );
  useEffect(() => {
    if (scopeId && !content) {
      setScopeId("");
      setVariantId("");
      setMode("task");
    }
  }, [scopeId, content]);
  useEffect(() => {
    if (!hidden && scroll.current && followTail.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [w.runs, live, hidden, scopeId]);
  useEffect(() => {
    if (
      mode === "draft" &&
      content?.variants.length &&
      !content.variants.some((v) => v.id === variantId)
    )
      setVariantId(content.variants[0].id);
  }, [content, mode, variantId]);
  useEffect(
    () =>
      api.onEvent((e) => {
        if (e.projectId !== w.project.id || !e.runId) return;
        const id = e.runId;
        if (e.type === "codex-delta")
          setLive((old) => ({
            ...old,
            [id]:
              (old[id] ?? w.runs.find((r) => r.id === id)?.output ?? "") +
              (e.text ?? ""),
          }));
        if (e.type === "codex-activity")
          setActivity((old) => ({ ...old, [id]: e.message ?? "" }));
      }),
    [w.project.id, w.runs],
  );
  const connect = async () => {
    setBusy(true);
    try {
      setCodex(await api.call<CodexStatus>("codex.connect"));
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const canSend =
    !!prompt.trim() &&
    (mode !== "draft" || !!content?.variants.some((v) => v.id === variantId)) &&
    codex.state === "ready" &&
    !w.project.readOnly &&
    !active &&
    !submitting;
  const start = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setSubmitting(true);
    try {
      if (!(await guard.current())) return;
      followTail.current = true;
      await api.call("codex.start", {
        projectId: w.project.id,
        contentId: content?.id,
        view: { page, contentId: viewingContent?.id },
        variantId: variantId || undefined,
        mode,
        prompt,
        model: model || undefined,
        reasoningEffort: validEffort || undefined,
      });
      setPrompt("");
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };
  return (
    <aside className="assistant" aria-label="Codex 助手" hidden={hidden}>
      <div className="assistant-header">
        <div className="ai-icon">
          <Sparkles size={18} />
        </div>
        <div>
          <h2>Codex 助手</h2>
          <small>
            <span className={`dot ${codex.state === "ready" ? "" : "gray"}`} />
            {codex.state === "ready" ? "本机已连接" : "等待连接"}
          </small>
        </div>
        <span className="pill tiny" title="可读写本机文件、执行命令和联网">
          Full Access
        </span>
      </div>
      <div className="assistant-context">
        <Folder size={14} />
        <span>{w.project.name}</span>
        <span className="context-label">当前项目</span>
      </div>
      <div className="assistant-scope">
        <label>
          对话范围
          <select
            aria-label="Codex 对话范围"
            value={scopeId}
            disabled={submitting}
            onChange={(e) => {
              followTail.current = true;
              setScopeId(e.target.value);
              setVariantId("");
              setMode("task");
            }}
          >
            <option value="">项目对话 · 从选题开始</option>
            {w.contents.map((c) => (
              <option key={c.id} value={c.id}>
                主题 · {c.title}
              </option>
            ))}
          </select>
        </label>
        <small>
          当前页面：{pageNames[page]}
          {viewingContent ? ` · ${viewingContent.title}` : ""}
        </small>
      </div>
      <div
        className="assistant-scroll"
        ref={scroll}
        onScroll={(e) => {
          const node = e.currentTarget;
          followTail.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 64;
        }}
      >
        {codex.state !== "ready" && (
          <div className="ai-welcome">
            <Sparkles size={27} />
            <h3>你的项目内容搭档</h3>
            <p>从选题、素材整理到写作和发布复盘，随时讨论或执行任务。</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? "正在连接…" : "连接本机 Codex"}
            </button>
            <p className="hint">{codex.message}</p>
          </div>
        )}
        {runs.length === 0 && codex.state === "ready" && (
          <div className="ai-welcome">
            <Sparkles size={27} />
            <h3>{content ? "这次需要完成什么？" : "从一个想法开始"}</h3>
            <p>
              {content
                ? "围绕这个主题讨论，或选择平台版本起草。"
                : "不用先创建内容。告诉我目标、灵感或难题，我们一起确定下一步。"}
            </p>
          </div>
        )}
        <div className="quick-actions">
          {(content
            ? [
                "按当前平台与语言起草",
                "根据事实底稿检查并改写",
                "翻译成英文，保持语气自然",
                "整理为适合群聊的简洁文案",
              ]
            : suggestions[page]
          ).map((t) => (
            <button
              key={t}
              onClick={() => {
                setMode(content ? "draft" : "task");
                setPrompt(t);
              }}
            >
              <Sparkles size={13} />
              {t}
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
        {[...runs].reverse().map((run) => (
          <div className="chat-run" key={run.id}>
            <div className="chat-user">{run.prompt}</div>
            <div className="chat-result">
              <div>
                <Sparkles size={14} />
                <strong>Codex</strong>
                <span>{statusName[run.status] ?? run.status}</span>
                {run.reasoningEffort && (
                  <small>
                    思考：
                    {effortLabels[run.reasoningEffort] ?? run.reasoningEffort}
                  </small>
                )}
              </div>
              <pre>
                {active?.id === run.id && live[run.id]
                  ? live[run.id]
                  : run.output || run.error || "正在准备当前身份与素材…"}
              </pre>
              {run.error && run.output && (
                <p className="warning-text">{run.error}</p>
              )}
              {["suggestion", "invalid"].includes(run.status) && (
                <button
                  className="text-button"
                  onClick={() => {
                    let body = run.output;
                    try {
                      body = JSON.parse(run.output).body ?? body;
                    } catch {
                      /* preserve raw result */
                    }
                    void api.call("clipboard.copy", { text: body });
                    notice("已复制建议内容，可粘贴到编辑器合并");
                  }}
                >
                  复制建议内容
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="assistant-input">
        <label>
          任务方式
          <select
            aria-label="Codex 任务方式"
            value={mode}
            disabled={!!active}
            onChange={(e) => setMode(e.target.value as "task" | "draft")}
          >
            <option value="task">讨论 / 执行任务</option>
            <option value="draft" disabled={!content}>
              起草版本
            </option>
          </select>
        </label>
        {content && (
          <label>
            {mode === "draft" ? "写入版本" : "参考版本"}
            <select
              aria-label="Codex 参考版本"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              {mode === "task" && <option value="">整个主题</option>}
              {content.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {getPlatformDefinition(w.platforms, v.platform).name} ·{" "}
                  {v.locale}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "draft" && !content?.variants.length && (
          <p className="hint">请先在内容编辑中添加平台版本。</p>
        )}
        <label>
          思考强度
          <select
            aria-label="Codex 思考强度"
            value={validEffort}
            disabled={!!active || !effortOptions.length}
            onChange={(e) => setEffort(e.target.value)}
          >
            <option value="">
              默认
              {defaultEffort
                ? " · " + (effortLabels[defaultEffort] ?? defaultEffort)
                : "（连接后读取）"}
            </option>
            {effortOptions.map((e) => (
              <option
                key={e.reasoningEffort}
                value={e.reasoningEffort}
                title={e.description}
              >
                {effortLabels[e.reasoningEffort] ?? e.reasoningEffort} ·{" "}
                {e.reasoningEffort}
              </option>
            ))}
          </select>
        </label>
        <div className="prompt-box">
          <textarea
            aria-label="Codex 生成要求"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key !== "Enter" ||
                e.shiftKey ||
                e.nativeEvent.isComposing ||
                e.nativeEvent.keyCode === 229
              )
                return;
              e.preventDefault();
              if (!e.repeat) void start();
            }}
            placeholder={
              mode === "task"
                ? "聊聊选题、素材或下一步，也可以直接交代任务…"
                : "描述文案要求，或选择一个动作…"
            }
            rows={3}
          />
          <div>
            <select
              aria-label="模型"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">CLI 默认模型</option>
              {codex.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {active ? (
              <button
                className="stop-button"
                aria-label="停止生成"
                onClick={() =>
                  void api
                    .call("codex.stop", {
                      projectId: w.project.id,
                      runId: active.id,
                    })
                    .catch((e) => notice(e.message))
                }
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="开始生成"
                disabled={!canSend}
                onClick={() => void start()}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
        <p className="hint">Enter 发送 · Shift+Enter 换行</p>
        <p>
          {active
            ? activity[active.id] || "结果将写回发起任务的项目"
            : mode === "task"
              ? "Full Access · 可改本机文件、执行命令和联网"
              : "Full Access · 文案写回所选版本"}
        </p>
      </div>
    </aside>
  );
}
function Assets({
  w,
  refresh,
  notice,
  progress,
}: Common & { progress: string }) {
  const [mode, setMode] = useState<"copy" | "reference">("copy"),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Asset | null>(null),
    [original, setOriginal] = useState(false),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [crop, setCrop] = useState(false),
    [rect, setRect] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const video = useRef<HTMLVideoElement>(null);
  const filtered = w.assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFiles = (paths?: string[]) =>
    call(async () => {
      const r = await api.call<{ status: string }[]>("assets.import", {
        projectId: w.project.id,
        mode,
        paths,
      });
      notice(
        `导入 ${r.filter((x) => x.status === "imported").length} 份，复用 ${r.filter((x) => x.status === "reused").length} 份，失败或跳过 ${r.filter((x) => ["failed", "skipped"].includes(x.status)).length} 份`,
      );
    });
  const frame = () =>
    call(async () => {
      const v = video.current!;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      await api.call("assets.derive", {
        projectId: w.project.id,
        assetId: selected!.id,
        kind: "frame",
        dataUrl: canvas.toDataURL("image/png"),
        parameters: { timeSeconds: v.currentTime },
      });
      notice("当前关键帧已另存为项目素材");
    });
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy) void importFiles(api.filePaths([...e.dataTransfer.files]));
      }}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">ASSET LIBRARY</div>
          <h1>
            素材库 <span className="count">{w.assets.length}</span>
          </h1>
          <p>收好每个画面，随时为内容所用。</p>
        </div>
        <div className="button-row">
          <select
            aria-label="导入方式"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="copy">复制到项目</option>
            <option value="reference">引用原文件</option>
          </select>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void importFiles()}
          >
            <Plus size={17} />
            导入素材
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["image", "图片"],
            ["video", "视频"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "selected" : ""}
              onClick={() => {
                setFilter(id);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search">
          <Search size={16} />
          <input
            placeholder="搜索素材"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void call(() =>
              api.call("assets.paste", { projectId: w.project.id }),
            )
          }
        >
          <Copy size={15} />
          粘贴截图
        </button>
      </div>
      {busy && (
        <div className="progress-note">{progress || "正在处理素材…"}</div>
      )}
      {!filtered.length ? (
        <div className="dropzone">
          <Empty
            icon={ImageIcon}
            title="把图片和视频带进来"
            text="拖放文件或文件夹到此处，支持 JPEG、PNG、WebP 和常见 MP4。"
            action={
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void importFiles()}
              >
                <FolderOpen size={16} />
                选择素材
              </button>
            }
          />
        </div>
      ) : (
        <div className="asset-grid">
          {filtered.slice(page * 60, page * 60 + 60).map((a) => (
            <button
              key={a.id}
              className="asset-card"
              onClick={() => {
                setSelected(a);
                setOriginal(false);
                setError("");
                setCrop(false);
              }}
            >
              <div className="asset-image">
                {a.availability !== "available" ? (
                  <div className="video-tile">
                    <AlertCircle size={28} />
                    <small>
                      {a.availability === "missing" ? "文件丢失" : "文件已变化"}
                    </small>
                  </div>
                ) : a.kind === "image" ? (
                  <AssetPreview
                    projectId={w.project.id}
                    asset={a}
                    alt={a.name}
                  />
                ) : (
                  <div className="video-tile">
                    <video
                      src={mediaUrl(w.project.id, a)}
                      preload="metadata"
                      muted
                    />
                    <span>
                      <Play size={24} />
                    </span>
                  </div>
                )}
                <em>{a.kind === "image" ? "图片" : "视频"}</em>
              </div>
              <div className="asset-card-info">
                <strong>{a.name}</strong>
                <small>
                  {(a.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                  {a.storageMode === "copy" ? "项目素材" : "外部引用"}
                  {a.derivedFrom ? " · 衍生副本" : ""}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}
      {filtered.length > 60 && (
        <div className="pagination">
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <span>
            {page + 1} / {Math.ceil(filtered.length / 60)}
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 60 >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {selected && (
        <Modal wide title={selected.name} onClose={() => setSelected(null)}>
          <div className="media-viewer">
            {selected.kind === "image" && !original ? (
              <AssetPreview
                projectId={w.project.id}
                asset={selected}
                alt={selected.name}
                detail
              />
            ) : selected.kind === "image" ? (
              <img
                src={mediaUrl(w.project.id, selected)}
                alt={selected.name}
                decoding="async"
                onError={() => setError("图片无法解码或源文件已丢失")}
              />
            ) : (
              <video
                ref={video}
                crossOrigin="anonymous"
                src={mediaUrl(w.project.id, selected)}
                controls
                preload="metadata"
                onError={() =>
                  setError(
                    "当前编码无法播放或源文件已丢失。可重连原文件；转码工具尚未内置。",
                  )
                }
              />
            )}
          </div>
          {error && <p className="warning-text">{error}</p>}
          <div className="media-details">
            <span>{(selected.bytes / 1024 / 1024).toFixed(2)} MB</span>
            <span>{selected.mime}</span>
            <span>
              {selected.storageMode === "copy" ? "项目素材" : "外部引用"}
            </span>
          </div>
          <div className="button-row">
            {selected.kind === "image" && (
              <button
                className="secondary"
                onClick={() => setOriginal(!original)}
              >
                <ImageIcon size={16} />
                {original ? "返回快速预览" : "查看原图"}
              </button>
            )}
            {selected.kind === "video" ? (
              <button className="secondary" onClick={() => void frame()}>
                <Camera size={16} />
                保存当前关键帧
              </button>
            ) : (
              <button className="secondary" onClick={() => setCrop(!crop)}>
                <Scissors size={16} />
                裁剪副本
              </button>
            )}
            <button
              className="secondary"
              onClick={() =>
                void call(() =>
                  api.call("assets.reconnect", {
                    projectId: w.project.id,
                    assetId: selected.id,
                  }),
                )
              }
            >
              <Link size={16} />
              重新定位
            </button>
            <button
              className="text-button danger"
              onClick={() =>
                void call(async () => {
                  await api.call("assets.remove", {
                    projectId: w.project.id,
                    assetId: selected.id,
                  });
                  setSelected(null);
                  notice("已移除素材登记，原文件保留");
                })
              }
            >
              <Trash2 size={15} />
              移除登记
            </button>
          </div>
          {crop && (
            <form
              className="crop-form"
              onSubmit={(e) => {
                e.preventDefault();
                void call(async () => {
                  await api.call("assets.derive", {
                    projectId: w.project.id,
                    assetId: selected.id,
                    kind: "crop",
                    parameters: rect,
                  });
                  setCrop(false);
                  notice("裁剪已另存副本，原图保持不变");
                });
              }}
            >
              {(["x", "y", "width", "height"] as const).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    min={0}
                    value={rect[k]}
                    onChange={(e) =>
                      setRect({ ...rect, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <button className="primary">保存裁剪副本</button>
            </form>
          )}
          <p className="hint">
            视频的播放与拖动由本机解码器完成；裁剪和关键帧会保存为新素材。
          </p>
        </Modal>
      )}
    </div>
  );
}
function Accounts({ w, refresh, notice }: Common) {
  const [profile, setProfile] = useState({
      ...w.profile,
      name: w.project.name,
      identityType: w.project.identityType,
      timezone: w.project.timezone,
    }),
    [tab, setTab] = useState("accounts"),
    [loginAccountId, setLoginAccountId] = useState(""),
    [accountModal, setAccountModal] = useState(false),
    [targetFor, setTargetFor] = useState<Account | null>(null),
    [platform, setPlatform] = useState<Platform>("wechat"),
    [label, setLabel] = useState(""),
    [externalId, setExternalId] = useState(""),
    [accountType, setAccountType] = useState("profile"),
    [kind, setKind] = useState<Target["kind"]>("group"),
    [targetLabel, setTargetLabel] = useState("");
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCOUNTS & IDENTITY</div>
          <h1>账号与定位</h1>
          <p>先明确“我是谁”，再决定“向哪里表达”。</p>
        </div>
        {tab === "accounts" && (
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => {
                setLoginAccountId("");
                setTab("web-login");
              }}
            >
              小红书网页登录
            </button>
            <button className="primary" onClick={() => setAccountModal(true)}>
              <Plus size={17} />
              登记平台账号
            </button>
          </div>
        )}
      </div>
      <div className="tabs">
        <button
          className={tab === "accounts" ? "selected" : ""}
          onClick={() => setTab("accounts")}
        >
          平台账号与目标
        </button>
        <button
          className={tab === "web-login" ? "selected" : ""}
          onClick={() => setTab("web-login")}
        >
          网页登录
        </button>
        <button
          className={tab === "connections" ? "selected" : ""}
          onClick={() => setTab("connections")}
        >
          自动发布连接
        </button>
        <button
          className={tab === "profile" ? "selected" : ""}
          onClick={() => setTab("profile")}
        >
          身份资料
        </button>
        <button
          className={tab === "platforms" ? "selected" : ""}
          onClick={() => setTab("platforms")}
        >
          平台管理
        </button>
      </div>
      {tab === "web-login" ? (
        <WebLoginPanel
          key={loginAccountId || "web-login"}
          w={w}
          initialAccountId={loginAccountId}
          refresh={refresh}
          notice={notice}
        />
      ) : tab === "connections" ? (
        <ConnectionsPanel w={w} refresh={refresh} notice={notice} />
      ) : tab === "platforms" ? (
        <PlatformManager />
      ) : tab === "profile" ? (
        <form
          className="card profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            void call(async () => {
              await api.call("project.profile", {
                projectId: w.project.id,
                ...profile,
                baseRevision: w.project.revision,
              });
              notice("身份资料已保存，下一次生成将使用这些资料");
            });
          }}
        >
          <h2>项目身份</h2>
          <div className="two-col">
            <label>
              项目名称
              <input
                required
                value={profile.name}
                onChange={(e) =>
                  setProfile({ ...profile, name: e.target.value })
                }
              />
            </label>
            <label>
              身份类型
              <select
                value={profile.identityType}
                aria-label="身份类型"
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    identityType: e.target.value as typeof profile.identityType,
                  })
                }
              >
                <option value="brand">品牌官号</option>
                <option value="founder">创始人 IP</option>
                <option value="custom">自定义身份</option>
              </select>
            </label>
          </div>
          <label>
            显示时区（IANA）
            <input
              value={profile.timezone}
              onChange={(e) =>
                setProfile({ ...profile, timezone: e.target.value })
              }
            />
          </label>
          <label>
            身份定位
            <textarea
              rows={4}
              value={profile.identity}
              onChange={(e) =>
                setProfile({ ...profile, identity: e.target.value })
              }
              placeholder="这个账号是谁，为谁提供什么价值？"
            />
          </label>
          <label>
            已确认事实
            <textarea
              rows={5}
              value={profile.facts}
              onChange={(e) =>
                setProfile({ ...profile, facts: e.target.value })
              }
              placeholder="品牌事实、产品名称、数据与允许引用的信息"
            />
          </label>
          <label>
            表达风格
            <textarea
              rows={4}
              value={profile.voice}
              onChange={(e) =>
                setProfile({ ...profile, voice: e.target.value })
              }
              placeholder="语气、术语、避免使用的表达"
            />
          </label>
          <div className="modal-actions">
            <button className="primary">保存身份资料</button>
          </div>
        </form>
      ) : (
        <>
          <div className="info-banner">
            <Users size={18} />
            <p>
              小红书可在“网页登录”中扫码登录。账号登记用于本地管理；官方 API
              授权请在“自动发布连接”中配置。
            </p>
          </div>
          {!w.accounts.length ? (
            <div className="card">
              <Empty
                icon={Users}
                title="登记你的第一个发布账号"
                text="一个账号可包含多个群、频道、页面或主页目标。"
              />
            </div>
          ) : (
            <div className="account-grid">
              {w.accounts.map((a) => (
                <section className="card account-card" key={a.id}>
                  <div className="section-heading">
                    <Badge platform={a.platform} />
                    <span className={`state ${a.enabled ? "" : "muted"}`}>
                      {a.enabled ? "辅助发布" : "已停用"}
                    </span>
                  </div>
                  <h2>{a.label}</h2>
                  <p>
                    {a.externalId || "仅本地登记"} · {a.accountType}
                  </p>
                  <div className="account-targets">
                    {w.targets
                      .filter((t) => t.accountId === a.id)
                      .map((t) => (
                        <div key={t.id}>
                          <span className="target-icon">
                            {t.kind === "group" ? (
                              <Users size={15} />
                            ) : (
                              <Send size={15} />
                            )}
                          </span>
                          <span>{t.label}</span>
                          <span className="muted">{t.kind}</span>
                        </div>
                      ))}
                    {!w.targets.some((t) => t.accountId === a.id) && (
                      <p className="hint">添加一个实际发布目标即可安排内容。</p>
                    )}
                  </div>
                  <div className="account-footer">
                    {a.platform === "xiaohongshu" &&
                      a.accountType !== "mock" && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setLoginAccountId(a.id);
                            setTab("web-login");
                          }}
                        >
                          登录 / 查看小红书
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setTargetFor(a);
                        setTargetLabel("");
                        setKind(
                          a.platform === "wechat"
                            ? "group"
                            : a.platform === "discord"
                              ? "channel"
                              : a.platform === "wechat_official"
                                ? "page"
                                : "profile",
                        );
                      }}
                    >
                      <Plus size={15} />
                      添加目标
                    </button>
                    <button
                      className="text-button muted"
                      onClick={() =>
                        void call(() =>
                          api.call("accounts.enabled", {
                            projectId: w.project.id,
                            accountId: a.id,
                            enabled: !a.enabled,
                          }),
                        )
                      }
                    >
                      {a.enabled ? "停用账号" : "启用账号"}
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}
          <div className="platform-strip">
            {w.platforms.map((p) => (
              <Badge key={p.id} platform={p.id} />
            ))}
          </div>
        </>
      )}
      {accountModal && (
        <Modal title="登记平台账号" onClose={() => setAccountModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void call(async () => {
                await api.call("accounts.add", {
                  projectId: w.project.id,
                  platform,
                  label,
                  externalId,
                  accountType,
                });
                setAccountModal(false);
                setLabel("");
                setExternalId("");
              });
            }}
          >
            <PlatformPicker value={platform} onChange={setPlatform} />
            <label>
              账号名称
              <input
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例如：品牌运营微信"
              />
            </label>
            <label>
              公开账号标识（选填）
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="用户名或公开账号 ID，勿填写令牌"
              />
            </label>
            <label>
              账号类型
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="profile">个人 / 主页账号</option>
                <option value="professional">专业账号</option>
                <option value="page">Facebook Page</option>
                <option value="channel">频道账号</option>
                <option value="operator">群运营身份</option>
                <option value="official">公众号账号</option>
              </select>
            </label>
            <p className="hint">
              此处保存公开标识与用途。保存后可使用网页登录或配置对应平台连接。
            </p>
            <div className="modal-actions">
              <button className="primary">保存账号</button>
            </div>
          </form>
        </Modal>
      )}
      {targetFor && (
        <Modal
          title={`为 ${targetFor.label} 添加目标`}
          onClose={() => setTargetFor(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void call(async () => {
                await api.call("targets.add", {
                  projectId: w.project.id,
                  accountId: targetFor.id,
                  label: targetLabel,
                  kind,
                });
                setTargetFor(null);
              });
            }}
          >
            <label>
              目标名称
              <input
                required
                value={targetLabel}
                onChange={(e) => setTargetLabel(e.target.value)}
                placeholder="例如：产品共创一群"
              />
            </label>
            <label>
              目标类型
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Target["kind"])}
              >
                <option value="group">群聊</option>
                <option value="channel">频道</option>
                <option value="profile">主页</option>
                <option value="page">Page 页面</option>
              </select>
            </label>
            <p className="hint">目标名称是本地记录，不会创建或加入真实群聊。</p>
            <div className="modal-actions">
              <button className="primary">添加目标</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Records({ w, refresh, notice }: Common) {
  const [selected, setSelected] = useState<Job | null>(null),
    [filter, setFilter] = useState("all"),
    [by, setBy] = useState(""),
    [date, setDate] = useState(localInput()),
    [result, setResult] = useState("已人工发送"),
    [url, setUrl] = useState(""),
    [segments, setSegments] = useState<number[]>([]),
    [busy, setBusy] = useState(false);
  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const jobs = w.jobs.filter(
    (j) =>
      filter === "all" ||
      (filter === "completed"
        ? ["completed", "published"].includes(j.status)
        : !["completed", "published", "cancelled"].includes(j.status)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PUBLISHING LOG</div>
          <h1>发布记录</h1>
          <p>每个目标独立留痕，每次完成都有依据。</p>
        </div>
        <span className="pill">辅助 / 自动 / 模拟发布</span>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["pending", "待完成"],
            ["completed", "已完成"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={id === filter ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted">共 {jobs.length} 个目标任务</span>
      </div>
      <div className="card records-card">
        {!jobs.length ? (
          <Empty
            icon={Send}
            title="还没有发布记录"
            text="在内容版本中标记就绪并安排发布后，逐目标任务会出现在这里。"
          />
        ) : (
          jobs.map((j) => (
            <div className="job-row" key={j.id}>
              <div className="job-main">
                <div>
                  <Badge platform={j.platform} />
                  <span
                    className={`state ${["completed", "published"].includes(j.status) ? "green" : j.status === "partial" ? "amber" : ""}`}
                  >
                    {j.mode === "simulation" ? "模拟 · " : ""}
                    {statusName[j.status]}
                  </span>
                  {j.status === "scheduled" &&
                    Date.parse(j.scheduledAtUtc) < Date.now() && (
                      <span className="state amber">已过截止时间</span>
                    )}
                </div>
                <h3>{j.title}</h3>
                <p>
                  {j.accountLabel} <ArrowRight size={12} /> {j.targetLabel}
                </p>
                <small>
                  {formatTime(j.scheduledAtUtc, j.timezone)} · 固定快照 ·{" "}
                  {j.segmentCount} 段消息
                </small>
                <JobAutomationActions
                  job={j}
                  refresh={refresh}
                  notice={notice}
                />
                {j.receipt && (
                  <p className="receipt-note">
                    {j.receipt.recordedBy} · {j.receipt.result} ·{" "}
                    {j.receipt.completedSegments.length}/{j.segmentCount} 段完成
                    {j.receipt.url && <span> · {j.receipt.url}</span>}
                  </p>
                )}
              </div>
              <div className="job-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void call(async () => {
                      await api.call("publish.export", {
                        projectId: w.project.id,
                        jobId: j.id,
                      });
                      notice("发布包已导出，任务仍需人工发布与回填");
                    })
                  }
                >
                  <Download size={15} />
                  导出发布包
                </button>
                {!["completed", "published", "cancelled"].includes(j.status) &&
                  (j.mode === "manual_due" ||
                    ["unknown", "accepted"].includes(j.status)) && (
                    <button
                      className="primary"
                      onClick={() => {
                        setSelected(j);
                        setBy(j.receipt?.recordedBy ?? "");
                        setDate(localInput());
                        setResult(j.receipt?.result ?? "已人工发送");
                        setUrl(j.receipt?.url ?? "");
                        setSegments(
                          j.receipt?.completedSegments ??
                            Array.from({ length: j.segmentCount }, (_, i) => i),
                        );
                      }}
                    >
                      回填结果
                    </button>
                  )}
              </div>
            </div>
          ))
        )}
      </div>
      {selected && (
        <Modal
          title={`记录结果 · ${selected.targetLabel}`}
          onClose={() => setSelected(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void call(async () => {
                await api.call("publish.record", {
                  projectId: w.project.id,
                  jobId: selected.id,
                  receipt: {
                    recordedBy: by,
                    recordedAt: new Date(date).toISOString(),
                    result,
                    url,
                    completedSegments: segments,
                  },
                });
                setSelected(null);
                notice("已保存此目标的人工发布记录");
              });
            }}
          >
            <div className="two-col">
              <label>
                实际发送人
                <input
                  required
                  value={by}
                  onChange={(e) => setBy(e.target.value)}
                />
              </label>
              <label>
                实际发送时间
                <input
                  required
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              发布结果或备注
              <textarea
                required
                rows={3}
                value={result}
                onChange={(e) => setResult(e.target.value)}
              />
            </label>
            <label>
              公开链接（可选）
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="微信群无公开链接时可留空"
              />
            </label>
            <label>已发送的消息段</label>
            <div className="segment-checks">
              {Array.from({ length: selected.segmentCount }, (_, i) => (
                <label className="check-row" key={i}>
                  <input
                    type="checkbox"
                    checked={segments.includes(i)}
                    disabled={selected.receipt?.completedSegments.includes(i)}
                    onChange={(e) =>
                      setSegments(
                        e.target.checked
                          ? [...segments, i]
                          : segments.filter((n) => n !== i),
                      )
                    }
                  />
                  第 {i + 1} 段
                </label>
              ))}
            </div>
            <p className="hint">
              只发送部分消息时，请取消未发送的段落，任务会保留为“部分完成”。
            </p>
            <div className="modal-actions">
              <button className="primary" disabled={!segments.length || busy}>
                保存人工记录
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Calendar({
  w,
  refresh,
  notice,
  onRecords,
}: Common & { onRecords: () => void }) {
  const [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("all"),
    [editing, setEditing] = useState<Job | null>(null),
    [date, setDate] = useState(""),
    [undo, setUndo] = useState<{ job: Job } | null>(null);
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return d;
  });
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: w.project.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    }
  };
  const changeDate = (j: Job, iso: string) =>
    call(async () => {
      await api.call("publish.update", {
        projectId: w.project.id,
        jobId: j.id,
        scheduledAtUtc: iso,
        status: "scheduled",
      });
      setUndo({ job: j });
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PUBLISHING CALENDAR</div>
          <h1>发布日历</h1>
          <p>给内容一个明确的时间。时区：{w.project.timezone}</p>
        </div>
        <button className="secondary" onClick={onRecords}>
          <Send size={16} />
          查看发布记录
        </button>
      </div>
      <div className="toolbar">
        <div className="button-row">
          <button
            className="icon"
            aria-label="上一周"
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>
            {base.getFullYear()} 年 {base.getMonth() + 1} 月
          </strong>
          <button
            className="icon"
            aria-label="下一周"
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="secondary small-button"
            onClick={() => setOffset(0)}
          >
            本周
          </button>
        </div>
        <select
          aria-label="日历平台筛选"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部平台</option>
          {w.platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted">拖动任务可改期</span>
      </div>
      <div className="calendar-grid">
        {days.map((d, i) => (
          <div
            className={`calendar-day ${key(d) === key(new Date()) ? "today" : ""}`}
            key={i}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const j = w.jobs.find(
                (j) => j.id === e.dataTransfer.getData("text/plain"),
              );
              if (j) {
                const original = new Date(j.scheduledAtUtc);
                const next = new Date(d);
                next.setHours(original.getHours(), original.getMinutes());
                void changeDate(j, next.toISOString());
              }
            }}
          >
            <div className="calendar-date">
              <span>
                {["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]}
              </span>
              <strong>
                {new Intl.DateTimeFormat("zh", {
                  timeZone: w.project.timezone,
                  day: "numeric",
                }).format(d)}
              </strong>
            </div>
            {w.jobs
              .filter(
                (j) =>
                  key(new Date(j.scheduledAtUtc)) === key(d) &&
                  j.status !== "cancelled" &&
                  (filter === "all" || j.platform === filter),
              )
              .map((j) => (
                <button
                  className={`calendar-job ${["completed", "published"].includes(j.status) ? "done" : ""}`}
                  draggable={
                    !["completed", "published", "partial"].includes(j.status) &&
                    !j.execution?.submittedAt
                  }
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", j.id)
                  }
                  key={j.id}
                  onClick={() => {
                    setEditing(j);
                    setDate(localInput(new Date(j.scheduledAtUtc)));
                  }}
                >
                  <Badge platform={j.platform} />
                  <strong>{j.title}</strong>
                  <span>{j.targetLabel}</span>
                  <small>
                    {formatTime(j.scheduledAtUtc, j.timezone)} ·{" "}
                    {statusName[j.status]}
                  </small>
                </button>
              ))}
          </div>
        ))}
      </div>
      <p className="hint">
        人工任务按截止时间提示；自动任务由本机开发服务执行。电脑休眠或关闭后，错过的任务不会集中补发。
      </p>
      {undo && (
        <div className="undo-bar">
          已修改任务时间
          <button
            className="text-button"
            onClick={() =>
              void call(async () => {
                await api.call("publish.update", {
                  projectId: w.project.id,
                  jobId: undo.job.id,
                  scheduledAtUtc: undo.job.scheduledAtUtc,
                  status: undo.job.status,
                });
                setUndo(null);
              })
            }
          >
            撤销改期
          </button>
        </div>
      )}
      {editing && (
        <Modal title={editing.title} onClose={() => setEditing(null)}>
          <p>
            {editing.accountLabel} → {editing.targetLabel}
          </p>
          <label>
            人工截止时间（本机时区）
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <p className="hint">
            显示：{formatTime(editing.scheduledAtUtc, editing.timezone)} ·{" "}
            {statusName[editing.status]}
          </p>
          <div className="modal-actions">
            {!["completed", "published", "cancelled", "partial"].includes(
              editing.status,
            ) && (
              <>
                <button
                  className="text-button danger"
                  onClick={() =>
                    void call(async () => {
                      await api.call("publish.update", {
                        projectId: w.project.id,
                        jobId: editing.id,
                        status: "cancelled",
                      });
                      setEditing(null);
                    })
                  }
                >
                  取消任务
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    void call(async () => {
                      await api.call("publish.update", {
                        projectId: w.project.id,
                        jobId: editing.id,
                        status: "paused",
                      });
                      setEditing(null);
                    })
                  }
                >
                  暂停
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    void changeDate(editing, new Date(date).toISOString());
                    setEditing(null);
                  }}
                >
                  保存改期
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function SettingsPage({
  w,
  theme,
  setTheme,
  codex,
  setCodex,
  notice,
  onRestore,
}: {
  w: Workspace;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  codex: CodexStatus;
  setCodex: (s: CodexStatus) => void;
  notice: (s: string) => void;
  onRestore: (w: Workspace) => void;
}) {
  const [includeExternal, setIncludeExternal] = useState(true),
    [busy, setBusy] = useState(false);
  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1>设置与备份</h1>
          <p>让本地数据可管理、可迁移、可恢复。</p>
        </div>
      </div>
      <div className="settings-stack">
        <section className="card settings-card">
          <div>
            <Sun size={22} />
            <h2>外观</h2>
            <p>默认使用浅色主题，也可以手动选择或跟随系统。</p>
          </div>
          <label>
            外观主题
            <select
              aria-label="外观主题"
              value={theme}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as ThemePreference;
                void call(async () => {
                  await api.call("settings.theme", { theme: next });
                  setTheme(next);
                });
              }}
            >
              <option value="light">浅色（默认）</option>
              <option value="dark">深色</option>
              <option value="system">跟随系统</option>
            </select>
          </label>
        </section>
        <PlatformManager />
        <BackgroundPanel projectId={w.project.id} notice={notice} />
        <section className="card settings-card">
          <div>
            <Folder size={22} />
            <h2>项目文件</h2>
            <p>{w.project.root}</p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              void call(() =>
                api.call("project.reveal", { projectId: w.project.id }),
              )
            }
          >
            打开文件夹
          </button>
        </section>
        <section className="card settings-card">
          <div>
            <Sparkles size={22} />
            <h2>本机 Codex</h2>
            <p>
              {codex.message} {codex.version}
            </p>
            <p>
              登录状态：
              {codex.authState === "signed-in"
                ? "已登录"
                : codex.authState === "pending"
                  ? "等待浏览器登录"
                  : codex.authState === "expired"
                    ? "登录失效 / 账号已切换"
                    : "未登录或尚未检查"}
            </p>
            {codex.account && (
              <p>
                账号：{codex.account.email || codex.account.type}{" "}
                {codex.account.planType ? " · " + codex.account.planType : ""}
              </p>
            )}
            {codex.checkedAt && (
              <small>
                最近检查：{new Date(codex.checkedAt).toLocaleString()}
              </small>
            )}
            <p>
              换号后请点击“检查登录并重连”。登录失败可点击“浏览器登录 /
              换号”，在浏览器选择目标账号。
            </p>
            <small>
              也可在终端执行 codex
              login，完成后回到这里检查登录并重连。登录入口使用本机
              CLI，不保存密码或令牌到项目。
            </small>
            <p>执行权限：Full Access（完全访问）</p>
            <small>
              可读写当前系统账号可访问的本机文件、执行命令和联网，包含项目外目录。
            </small>
          </div>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void call(async () => {
                  await api.call("settings.codexPath");
                  notice("CLI 路径已保存，请检查登录并重连");
                })
              }
            >
              选择 CLI
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void call(async () =>
                  setCodex(await api.call<CodexStatus>("codex.connect")),
                )
              }
            >
              检查登录并重连
            </button>
            <button
              className="secondary"
              disabled={busy || codex.loginPending}
              onClick={() =>
                void call(async () =>
                  setCodex(await api.call<CodexStatus>("codex.login")),
                )
              }
            >
              浏览器登录 / 换号
            </button>
            {codex.loginPending && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void call(async () =>
                    setCodex(await api.call<CodexStatus>("codex.login.cancel")),
                  )
                }
              >
                取消登录
              </button>
            )}
          </div>
        </section>
        <section className="card backup-card">
          <div className="section-heading">
            <h2>一致性备份</h2>
            <span className="pill">本地文件夹</span>
          </div>
          <p>
            备份身份、文案、素材、历史、发布快照、SQLite
            任务与应用会话记录。不会包含 Codex 登录凭据。
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeExternal}
              onChange={(e) => setIncludeExternal(e.target.checked)}
            />
            包含已登记的外部引用素材
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void call(async () => {
                  const result = await api.call<string | null>(
                    "backup.create",
                    { projectId: w.project.id, includeExternal },
                  );
                  if (result) notice("备份已保存到 " + result);
                })
              }
            >
              <Download size={16} />
              导出项目备份
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void call(async () => {
                  const restored = await api.call<Workspace | null>(
                    "backup.restore",
                  );
                  if (restored) {
                    onRestore(restored);
                    notice("备份已恢复，未完成任务已暂停");
                  }
                })
              }
            >
              <RefreshCw size={16} />
              恢复备份
            </button>
          </div>
          <p className="hint">
            恢复到空目录，并切换到恢复项目；原项目保留。所有未完成发布任务默认暂停。
          </p>
        </section>
        <section className="card backup-card">
          <h2>当前能力</h2>
          <div className="capability-line">
            <span className="dot" />9 个平台辅助发布包与人工回填
          </div>
          <div className="capability-line">
            <span className="dot" />
            图片预览、常见 MP4 播放、裁剪副本与关键帧
          </div>
          <div className="capability-line">
            <span className="dot gray" />
            四个平台图文连接已实现，真实发布待验证；可先用本地模拟验收
          </div>
          <p className="hint">
            v0.2 开发版 · 单机单写入者。完全退出应用会停止 AI
            与本地排期；托盘运行可继续处理。云端同步与视频转码尚未启用。
          </p>
        </section>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
