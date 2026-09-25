# Contributing

感谢参与 Media Diff！本文档说明本地开发、测试与提交规范。

## 开发环境

- Python >= 3.10（推荐 3.13+）
- Node.js >= 18（仅前端开发 / 构建需要）
- [uv](https://docs.astral.sh/uv/)（推荐）

```bash
uv sync --extra test
cd frontend && npm install
```

## 开发模式

前后端分离启动，支持热更新：

```bash
# 终端 1：后端
uv run python -m media_diff --reload

# 终端 2：前端（Vite dev server，自动代理 /api）
cd frontend && npm run dev
```

## 代码风格

- 后端：遵循 PEP 8，使用类型注解。
- 前端：TypeScript + React Hooks，提交前通过 `npm run lint`（oxlint）。

## 提交前检查

请确保以下命令全部通过：

```bash
uv run pytest
cd frontend && npm run lint
cd frontend && npm run build
```

测试通过 `MEDIA_DIFF_STATE_DIR` 将运行实例注册表重定向到临时目录，不会污染本机状态。

## 前端构建产物

`media_diff/static/` 是前端构建产物，**需要提交到仓库**（保证 `pip install` 后开箱即用）。修改前端源码后，务必重新构建并提交产物：

```bash
cd frontend && npm run build
```

## 提交信息

- 使用简洁的祈使句描述改动，例如 `fix: 修复跨窗口帧缓存互相 revoke`。
- 一个提交聚焦一件事，避免混入无关格式化改动。

## 发布流程

1. 更新 `media_diff/__init__.py` 中的 `__version__`。
2. 构建前端：`cd frontend && npm run build`。
3. 构建发行包：`uv build`。
4. 发布：`uv publish`（或 `twine upload dist/*`）。
