# 各平台封面与本地统一管理

资料核查日期：2026-09-09。范围为工作台现有十个平台，按发布类型区分。来源优先采用平台官方帮助与开发文档；SDK/API 的字段只证明相应入口能力。未通过真实账号核实的上传入口明确标为待核实。

## 先区分“图文”的含义

封面不一定是正文的一部分。“图文笔记 / 图片轮播”和“含图片的长文章”不能按一套规则处理。比如公众号长文章用单独封面字段，公众号图片消息则取图片列表第一张。视频文件和视频封面通常可分开准备，但具体上传方式取决于平台入口。

“可上传另一张图片”指文件可以独立，不表示封面可以与实际内容无关。另制海报、文字和构图应准确概括内容。裁切通常只影响展示，不等于改变原始媒体。

## 平台差异

| 平台 / 发布类型 | 与正文的关系 | 单独上传 / 本地处理 | 资料与适用范围 |
| --- | --- | --- | --- |
| 小红书·图文笔记 | 官方分享 SDK 接收图片列表，没有独立图文封面字段 | 本地按首图管理；另制封面图会加入正文第一张。客户端封面编辑、裁切能力另行核实 | [官方分享 SDK](https://agora.xiaohongshu.com/doc/harmony)；不据此断言所有客户端都只能用首图 |
| 小红书·视频笔记 | 视频与封面分别传入，封面可选 | 可在本地单独导入图片，不要求为视频某一帧 | [官方分享 SDK](https://agora.xiaohongshu.com/doc/harmony) |
| YouTube·普通视频 | 独立缩略图，也有平台建议图 | 账号验证后可上传自定义封面；官方建议 16:9、3840×2160，最小宽640，JPG/PNG；桌面50MB、移动端视频封面2MB | [官方缩略图帮助](https://support.google.com/youtube/answer/72431?hl=en) |
| YouTube·Shorts | 独立缩略图 / 平台建议帧 | **最新官方页已允许电脑端 YouTube Studio 上传自定义图片**，需验证账号。建议9:16、2160×3840，最小高640，桌面50MB | [官方缩略图帮助](https://support.google.com/youtube/answer/72431?hl=en)；旧的“Shorts不能上传自定义封面”不再沿用 |
| B站·视频投稿 | 稿件 cover 字段与视频分开 | 可单独准备；开放平台要求 cover 使用封面上传接口返回的地址 | [官方视频稿件提交](https://open.bilibili.com/doc/4/f7fc57dd-55a1-5cb1-cba4-61fb2994bf0f) |
| B站·图文动态 | 正文图片 / 附件 | 本地不提供独立封面操作；未核实普通图文动态的独立封面入口 | 视频投稿资料不能用于证明动态封面能力 |
| 抖音·短视频 | 本地独立准备候选图 | 本次公开资料未完整核实各客户端的选帧、独立上传、横竖封面入口，保留候选文件供发布时确认 | [官方分享方案](https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-share-solution)、[官方创作者中心](https://creator.douyin.com/)；明确区分已知媒体类型与待核实封面能力 |
| 抖音·图文作品 | 本地按图片列表首图管理 | 导入首图会进入内容；不据此推断所有发布入口都不支持单独编辑封面 | [官方分享方案](https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-share-solution)；独立图文封面上传待入口核实 |
| Instagram·帖子 / 轮播 | 正文首个媒体作为本地展示图 | 图片轮播没有 Reel 的 cover_url；换首图会改变内容排序。首个媒体为视频时不能当作图片文件 | [官方 IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) |
| Instagram·Reel | 可独立图片，也可从视频取帧 | cover_url 指定图片，thumb_offset 指定帧；同时设置优先用图片。网格与 Reels 展示可能不同裁切 | [官方 IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) |
| Instagram·Story | Story图片/视频本身 | 本地无独立封面；精选集封面是另一个功能 | [官方 IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) |
| Facebook·图文帖子 | 正文照片与排序 | 无本地独立封面操作 | 普通照片帖子与视频发布、链接预览分开处理 |
| Facebook·链接帖子 | 网页分享元信息生成卡片 | 附加一张照片不等于替换链接封面；有网页管理权时可调整分享元信息 | [官方网页分享元信息](https://developers.facebook.com/docs/sharing/webmasters/images/) |
| Facebook·视频 / Reel | 官方电脑端流程提供选择封面 | 可单独准备候选图片；外部图片上传是否可用按实际账号和入口核实 | [官方创建 Reel 帮助](https://www.facebook.com/help/2862139500770200/) |
| 微信公众号·长文章（图文消息） | thumb_media_id 与正文独立 | 可单独上传；不要求为正文首图。官方提供2.35:1和1:1裁切。需要在正文中显示时再安排正文配图 | [官方新增草稿](https://developers.weixin.qq.com/doc/service/en/api/draftbox/draftmanage/api_draft_add.html)中的 news 类型 |
| 微信公众号·图片消息 | 官方指定图片列表第一张为封面 | 本地选封面会加入并移动到正文首位 | [官方新增草稿](https://developers.weixin.qq.com/doc/service/en/api/draftbox/draftmanage/api_draft_add.html)中的 newspic 类型 |
| X·普通图文 | 正文图片 | 本地无独立封面；网页卡片另由链接元信息决定 | [官方发帖帮助](https://help.x.com/en/using-x/how-to-post) |
| X·视频 / Media Studio | 可视频帧或独立图片 | Media Studio 可从电脑上传封面，要求封面比例与视频一致；需具备入口权限，Safari 不支持此图片操作 | [官方 Media Studio FAQ](https://help.x.com/en/using-x/media-studio-faqs)；不能直接套用普通发帖框或 API |
| Discord·频道消息 | 图片、视频属于消息附件 | 无独立帖子封面；Embed 缩略图是另一个功能 | 本地频道消息范围 |
| Discord·论坛帖 | 缩略图来自加入原帖的媒体，仍是帖内内容 | 官方支持回复图片后选择 Add to Post，让图片加入原帖并用作缩略图。本地在正文附件/消息段中安排 | [官方论坛 FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ) |
| 微信群·消息 / 公告 | 图片、视频本身作为内容发送 | 无本地独立封面；链接卡片由链接/小程序提供 | 本地群消息范围；不套用公众号文章规则 |

## 本地怎么用

1. 打开主题的平台版本，在“封面管理”看当前类型的说明；小红书新增“图文笔记 / 视频笔记”，公众号新增“长文章 / 图片消息”。
2. 点击“导入封面”或“导入首图”，直接选择本机图片并复制到项目素材库。支持 JPEG、PNG、WebP；已导入的相同文件会复用。也可从素材库选择图片或之前截取的视频关键帧。
3. 首图类型：选择的图片进入正文第一位。以后调整正文媒体顺序，封面、内容列表缩略图、右侧预览和新发布包都跟随新的第一张。
4. 独立封面：选图只设置封面，正文媒体不变。素材行的封面按钮可让正文图片兼作封面；之后移除正文关联仍保留独立封面。要删除封面关联，请用“清除封面”。
5. 点击“保存草稿”。素材库新增“封面”筛选；点击素材可看其使用主题、平台和语言。同一张图片可被多个版本复用。
6. 标记就绪并安排任务后，发布快照固定封面文件、正文顺序、规则、来源和核查日期。导出的“发布信息.md”注明封面用途与文件名；独立封面不混入“发送顺序.md”的正文附件。

## 保存与兼容

- 每个平台语言版本独立保存封面；各类型仍共用该版本保留的独立封面图片，需要横竖不同设计时可换图或准备不同版本。
- 切换类型保留原独立封面；首图或无封面类型不会继续把它当当前封面。界面和导出都会标注保留但不使用的图片，可手动清除。
- 老草稿无需迁移。旧 coverId 不再强制覆盖图文实际图片顺序，避免预览与发布包不一致。版本历史、备份和删除引用检查沿用现有机制。
- 封面是项目图片素材，可复用素材库的裁切副本与关键帧功能。本次不自动裁切、不嵌入封面文案、不把封面烧进视频。
- 自定义平台或自定义编辑方式使用对应本地策略，标明原生规则待核实。
- 现有自动发布连接仍按各自已接入的能力工作。没有接入的独立封面不会被静默忽略，会提示改用辅助发布包；本次没有向任何真实账号提交内容。

## 验证

覆盖首图排序一致性、视频封面与正文分离、导入去重、类型切换、历史与重开、不可用/跨项目引用校验、固定快照导出及自动连接不丢封面。另通过真实 Electron 界面验证导入、预览、保存和素材库封面用途。

运行 `npm test`、`npm run test:integration`、`npm run test:publishing`、`npm run typecheck`、`npm run lint`。桌面测试：先 `npm run build`，再 `npx playwright test tests/covers.e2e.ts`。
