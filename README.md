# dsh-companion

一个完全可自定义的陪伴 Agent（DeepSeek Harness 插件）——名字、性格、声音都由你
在对话里配置，不需要 fork 仓库或发布新包。声音由 **Qwen3-TTS**（本地部署在
mac mini 上）生成，浏览器播放——跨平台（macOS / Windows / Chrome / Edge /
Safari），无需服务器 TTS 或 API key。

> 任意人设 · 任意声音 · 每个会话自己的定时问候 · 零构建

## 亮点

- **会话内配置**：会话标题旁的 👤 按钮打开配置窗口——填名字、性格设定，选一个
  内置音色（点击试听）或直接用文字描述一个全新的声音，Qwen3-TTS 会按你的描述
  生成。保存立刻生效，不用重启。
- **每个会话独立**：人设按会话保存，不同会话可以是完全不同的搭档；新会话在
  第一次保存前使用一个通用的默认人设（小助手）。
- **自动朗读每一句回复**：搭档每次回话都会说出口，用的是这个会话保存的声音。
- **`speak` / `cheer` 模型工具**：搭档可随时要求把某句念出来，或弹出 💛 打气卡片。
- **每个搭档自己的定时问候**：在配置窗口里加一个或多个时间（HH:MM），到点会
  用这个搭档的人设生成一句问候，只送进这一个会话——不会影响其他会话。

## 架构

```
浏览器 (dsh web GUI)                 mac mini (dsh host)
┌─────────────────────┐   /dsh-companion/tts     ┌──────────────────────────┐
│  client.js            │ ───────────────────────► │ dsh-companion 插件 (Node) │
│  fetch WAV → <audio>  │                          │  代理 → 127.0.0.1:3091   │
└─────────────────────┘                          └──────────┬───────────────┘
                                                            │ http
                                              ┌─────────────▼─────────────┐
                                              │ tts_service.py (FastAPI)  │
                                              │ Qwen3-TTS-12Hz-1.7B-      │
                                              │ VoiceDesign (MPS)         │
                                              └───────────────────────────┘
```

人设/声音/问候时间存在 `$DSH_HOME/state/dsh-companion/personas/<sessionId>.json`，
按会话读写；系统提示词按会话动态渲染（一个 preset composition 每进程只挂载
一次，被所有会话共享，所以人设不能写死在插件启动时的闭包里）。问候调度也是
按会话独立跑的一套小定时器，不是所有会话共用一个全局时间表。

## 安装

### 1. mac mini 上部署 TTS 服务（只需一次）

```bash
brew install portaudio ffmpeg sox
/usr/local/bin/python3.12 -m venv ~/qwen-tts-venv
~/qwen-tts-venv/bin/pip install -U qwen-tts
# 把 tts_service.py 放到 ~/tts_service.py，然后：
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dsh.sister-tts.plist
```

### 2. 安装插件

```bash
dsh plugin --profile web add github:Yihong89/dsh-sister
```

Bundle patch 有意为空——插件只在预设里显式写了 `name: dsh-companion` 行时才
激活（即 `companion` 预设 `~/.dsh/.agent-presets/companion/agent.cordis.yml`）。

### 3. 创建 `companion` 预设

`~/.dsh/.agent-presets/companion/agent.cordis.yml`：

```yaml
- insert:
    - id: dsh-companion
      name: dsh-companion
```

用这个预设新建会话后，点会话标题旁的 👤 按钮即可开始配置。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/speak on\|off` | 开关自动朗读 |
| `/speak <text>` | 立刻把文字念出来 |
| `/cheer [text]` | 立刻送一句打气（朗读 + 💛 卡片）；不写文字用内置语库 |

> `/cheer-at` / `/cheer-text` 命令仍然存在（继承自 dsh-voice-core），但对
> dsh-companion 没有实际效果——问候时间现在存在每个会话自己的人设文件里，
> 只能通过 👤 配置窗口设置。这是已知的一处粗糙边缘，留给后续清理。

## 已知限制

- 声音预览、试听音频不会被缓存/预生成——每次点击都会实时调用 Qwen3-TTS
  （几秒钟）。
- `/cheer-at` / `/cheer-text` 命令对问候时间不再生效（见上）。

## 测试

```bash
node --test test/*.test.js
```

## License

MIT
