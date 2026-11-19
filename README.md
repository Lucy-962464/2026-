# 社区老年人个性化认知活动支持系统

面向社区日间照料中心老年人的**序列记忆训练** Web 应用。平板优先、电脑兼容，全部界面按 65 岁以上人群的可读性与触控尺寸设计。

参与者完成一次活动的闭环：

```
输入身份证号 → 读取偏好 → 按历史成绩推荐任务 → 指导语 + 练习
→ 正式作答 3 题 → 服务端自动评分 → 体验反馈 → 数据入库 → 下次推荐随成绩调整难度
```

## 特性

- **零构建**：纯静态 HTML / CSS / 原生 JS，不需要 npm、打包器或框架
- **平板优先**：基准 1024×768，断点 768 / 1200，按钮最小 56px，正文 20–24px
- **成绩不可篡改**：评分只在服务端 RPC 里算，前端对 `task_attempts` 只有读权限
- **身份证不落库**：只保存 PBKDF2 派生的不可逆编号，界面仅显示尾号
- **自适应难度**：按历史正确率在 easy / medium / hard 之间切换模板
- **可回归**：内置 4 个自动化测试页，覆盖 26 + 22 + 13 + 9 个断言

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | 原生 JS（ES2017）、单一 CSS 文件、WorkBuddy Cloud SDK（`vendor/index.global.js`） |
| 后端 | 托管 PostgreSQL + Row Level Security，业务逻辑写成 plpgsql 函数 |
| 部署 | 静态托管（WorkBuddy Sites），单页应用，无服务端运行时依赖 |

## 目录结构

```
cognitive-activity-web/      ← 发布目录（线上只部署这一层）
├── index.html               入口，0 秒跳转到 participant.html
├── participant.html         P01–P06 六个页面结构
├── css/style.css            全部样式（含三档响应式）
├── js/config.js             云端 endpoint / publishableKey
├── js/identity.js           身份证校验 + 编号派生
├── js/api.js                所有后端调用的唯一出口
├── js/participant.js        页面状态机与交互逻辑
├── vendor/index.global.js   第三方 SDK
└── robots.txt               禁止搜索引擎收录

dev/                         ← 开发与测试（不发布）
├── e2e.html                 端到端全链路测试（26 断言）
├── login_test.html          身份识别与建档测试（22 断言）
├── ui_login_test.html       登录页 UI 与触控规格测试（13 断言）
├── relogin_test.html        二次登录与偏好跳过测试（9 断言）
└── sql/                     5 个后端函数定义

tools/                       ← 测试驱动脚本
├── cdp_test.mjs             用 CDP 驱动无头 Edge 跑测试页
└── shot_flow.mjs            按平板尺寸批量截图
```

## 本地运行

需要一个静态服务器（不能用 `file://` 打开，云端接口会因 Origin 不匹配拒绝）：

```bash
# 在仓库根目录执行
python -m http.server 8099
```

- 应用：<http://127.0.0.1:8099/cognitive-activity-web/participant.html>
- 测试：<http://127.0.0.1:8099/dev/e2e.html>

测试页需要 Edge 装在默认路径，然后：

```bash
node tools/cdp_test.mjs "http://127.0.0.1:8099/dev/e2e.html"
```

## 页面与状态机

| 页面 | 说明 |
|---|---|
| P01 欢迎 | 身份证输入 + 「测试演示」虚拟编号入口 |
| P02 偏好 | 主题偏好选择，可跳过（跳过也会写默认值） |
| P03 推荐 | 推荐卡片、历史提示、「换一项材料」 |
| P04 指导语 | 三步图文 + 练习入口 |
| P05 任务 | 准备 → 逐个呈现 → 保持 → 点选作答（可撤销） |
| P06 反馈 | 三宫格小结 + 体验评价 + 结束清除信息 |

```
READY → INSTRUCTION → PRACTICE → PREPARE → PRESENTING
      → RETENTION → RESPONDING → SUBMITTED → … → FEEDBACK → COMPLETED
```

约束：`PRESENTING` 禁止任何操作；`RETENTION` 空白屏防复述；提交按钮在选择数量达到题量前禁用。

## 数据模型

9 张业务表：`participants`、`participant_preferences`、`sessions`、`task_templates`、`materials`、`material_groups`、`task_attempts`、`task_events`、`feedback`。

服务端函数：

| 函数 | 职责 |
|---|---|
| `get_recommendation` | 按历史正确率定难度（≥0.8 hard / ≥0.6 medium / 其余 easy），随机取未做过的模板 |
| `create_attempt` | 从素材组随机抽取 n 个物品，落库呈现序列 |
| `submit_attempt` | 评分：位置正确数、物品再现数、是否全对；已提交状态直接拒绝 |
| `interrupt_attempt` | 中断标记 |
| `cleanup_stale_attempts` | 清理上次遗留的进行中记录 |

## 隐私设计

1. 身份证号仅用于本地派生，**不上传、不存库、不写日志**；
2. 派生：PBKDF2-HMAC-SHA256，210000 次迭代，固定盐，输出 64 位十六进制；
3. 同一身份证号派生结果稳定，因此可找回历史；
4. 顶栏只显示「身份证尾号 xxxx」；
5. 退出会话即清空 `sessionStorage` 与输入框；
6. 测试用 `TEST-` 前缀虚拟编号，明文存储、独立标记，便于清理。

## 已知限制

- 无后台管理界面：新增素材、发布模板需直接操作数据库
- 无语音播报与更高对比度模式
- 断网无离线兜底
- 窄竖屏（<768px）仅做基础单列适配

## 说明

本项目为课程/毕业设计用途，示例密码与测试数据均为虚构。第三方 SDK 版权归其作者，见 `vendor/`。
