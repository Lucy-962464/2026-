# 远程试玩数据收集

被试收到的是每人一份的 HTML 邀请文件。双击后打开现有 GitHub Pages 游戏。接受试玩记录说明并成功核验邀请后，游戏会持续同步逐轮数据。公开试玩链接继续保留本机模式。

## 接入数据库

1. 在研究团队的 Supabase 项目中执行 [数据库迁移](research/schema.sql)。迁移创建私有表、只写入的接收函数以及用于 CSV 的导出视图。
2. 把项目 HTTPS 地址和 publishable key 配到 [study.mjs](study.mjs) 的 `CLOUD_CONFIG`。管理员密钥只留在项目管理侧。
3. 用 [邀请码生成 SQL](research/create-invites.sql) 创建随机研究编号和令牌。按需填不同编号和到期时间。一次邀请绑定一次试玩会话，同一浏览器可以刷新继续。
4. 打开 [邀请文件生成器](research/invite-maker.html)，逐一生成要发送的 HTML。邀请文件会打开网页，需要联网。不要把带有效邀请码的 HTML 文件上传到公开仓库。
5. 正式发出前，用专门的模拟邀请码检查练习、提交、断网、联网补传和导出。测试编号可用 T001 等单独标记，分析时过滤。

## CSV 导出

项目负责人在 Supabase SQL Editor 中运行以下查询，并导出查询结果 CSV。

```sql
select * from bento_research.trial_export
order by participant_code, case mode when 'practice' then 0 else 1 end, trial_number;
```

每行包含一次试次的编号、类型、实际菜数、目标和选序、正确表现与完成率、反应时、提示及撤回事件和下一轮决策。收到同一轮的相同重试时只写一条。未获云端确认的记录留在当前浏览器，恢复联网且页面仍打开时自动补传。用原设备重新打开邀请也可恢复补传。
