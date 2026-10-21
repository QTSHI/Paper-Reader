# 贡献指南

## 开始之前

Paper Reader 目前是面向个人使用的 Zotero 10/macOS MVP。欢迎改进安装说明、报告可复现的解析问题，或围绕现有阅读流程提交小范围修复。

先阅读 [README](README.md) 中的系统要求、模型配置和当前边界。优先围绕现有阅读流程提交可独立检查的小范围改动。

## 开发与验证

在安装 Node.js 22 或更高版本及 `zip` 的 macOS 上执行：

```bash
npm ci
npm run build
```

`build` 已包含类型检查和自动测试，产物为 `dist/paper-reading-assistant-0.2.1.xpi`。安装和 API Key 配置见 [README](README.md)。只检查代码时可分别运行 `npm run typecheck` 和 `npm test`。

应用运行仍依赖 Zotero、macOS 钥匙串与可提取文本的 PDF；命令行检查通过不能证明插件界面、钥匙串、SQLite 或真实模型调用已通过实机验收。

### 测试范围

- 常规 `npm test` 检查文本处理、模型响应 JSON 解析、来源与全文覆盖校验，不调用外部模型。
- `tests/pdf.smoke.test.ts` 仅在设置 `PAPER_READER_TEST_PDF` 后运行。使用可以分享的非敏感 PDF，并记录文件类型、页数及版式。
- `scripts/smoke-deepseek.ts` 是真实模型实验，需 macOS 钥匙串中的密钥和测试 PDF，不在常规测试或 CI 中运行。不要为复现问题把密钥放进命令、代码或日志。
- `src/generation/mock.ts` 只选择部分章节和文本块生成预览，不能用来宣称完整论文覆盖或翻译质量。

如果修改 PDF 解析、来源跳转、图表显示或数据库行为，请补充 Zotero 10/macOS 的手动复现步骤与实际结果。涉及模型输出时，应返回原论文页码核对，区分作者结论和阅读辅助。

## 提交 Issue

报告问题时写明 macOS、Zotero、插件版本，复现步骤、预期与实际行为，以及经过脱敏的报错。可提供公开论文链接或最小样例；不要上传私人文库、SQLite 数据库、API Key、未公开论文或未经允许分享的全文/图表。

功能建议请说明使用场景、当前阅读流程中的阻碍、希望得到的结果及尝试过的替代方式。

## 提交 PR

PR 请说明改动原因、影响范围和实际运行的检查。README 中的单篇 STADNet 实测记录属于已有项目记录，新增测试结论应附自己的环境与样本，不能据此推导通用准确率。

## 数据与生成文件

保持源码与生成物分开：编辑 `src/`、`addon/`、`scripts/` 中的源文件，不提交 `node_modules/`、`build/`、`dist/`、XPI、数据库或生成的论文阅读页面。方案文档和现有参考图片应保留来源与上下文。
