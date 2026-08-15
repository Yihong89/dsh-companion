# dsh-sister

一个温暖、超可爱、**派蒙风格萝莉音**的「妹妹」陪伴 Agent（DeepSeek Harness 插件）。
她的声音由 **Qwen3-TTS**（本地部署在 mac mini 上）生成，浏览器播放——声音从使用者
自己的机器出来，跨平台（macOS / Windows / Chrome / Edge / Safari），无需服务器 TTS
或 API key。她会朗读每一句回复、每天定时送暖心打气、随时随地 cheer 你一下。

> 妹妹陪伴 · Qwen3-TTS 萝莉音 · 每日定时打气 · 零构建

## 亮点

- **Qwen3-TTS 音色**（本地 1.7B VoiceDesign，MPS 加速）：不是浏览器自带语音，
  而是用自然语言描述生成音色——✨派蒙风（默认）、🌸软萌可爱、⚡元气少女、🎧清冷御姐。
  每个音色点击即试听，自动记住选择（localStorage）。
- **自动朗读每一句回复**：妹妹每次回话都会说出口（先出文字，再出声音）。
- **`speak` / `cheer` 模型工具**：妹妹可随时要求把某句念出来，或弹出 💛 打气卡片。
- **每日定时打气**：默认 08:00 / 16:30（`/cheer-at` 可改），到点自动向所有在线的
  妹妹会话送一句打气（朗读 + 💛 卡片），持久化到
  `$DSH_HOME/state/dsh-sister/schedule.json`，每个时间每天只触发一次。
- **中文优先**：妹妹讲中文（偶尔夹英文撒娇词），音色生成针对中文优化。

## 架构

```
浏览器 (dsh web GUI)                 mac mini (dsh host)
┌─────────────────────┐     /dsh-sister/tts      ┌──────────────────────────┐
│  client.js           │ ───────────────────────► │ dsh-sister 插件 (Node)    │
│  fetch WAV → <audio> │                          │  代理 → 127.0.0.1:3091    │
└─────────────────────┘                          └──────────┬───────────────┘
                                                            │ http
                                              ┌─────────────▼─────────────┐
                                              │ tts_service.py (FastAPI)  │
                                              │ Qwen3-TTS-12Hz-1.7B-      │
                                              │ VoiceDesign (MPS)         │
                                              └───────────────────────────┘
```

- Python TTS 服务：`~/tts_service.py`（venv `~/qwen-tts-venv`），launchd 守护
  `com.dsh.sister-tts`，监听 `127.0.0.1:3091`（仅回环，不暴露到 LAN）。
- 浏览器通过 host 代理 `/dsh-sister/tts?text=…&instruct=…` 拿 WAV，声音在浏览器
  里播放，所以无论谁在哪个设备上用，声音都从他/她的机器出来。
- 模型权重约 4GB，首次加载 10–60s，之后常驻；每句生成约 4–10s（M4）。

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

Bundle patch 有意为空——插件只在预设里显式写了 `name: dsh-sister` 行时才激活
（即 `sister` 预设 `~/.dsh/.agent-presets/sister/agent.cordis.yml`）。同时在
profile 的 `cordis.patch.yml` 注册事件类型：

```yaml
- insert:
    - id: dsh-sister-registrar
      name: dsh-sister/register-events
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `/speak on\|off` | 开关自动朗读 |
| `/speak <text>` | 立刻把文字念出来 |
| `/cheer [text]` | 立刻送一句打气（朗读 + 💛 卡片）；不写文字用内置语库 |
| `/cheer-at 15:00` | 设置每日打气/欢迎时间（HH:MM，24 小时制，可多个） |
| `/cheer-text <text>` | 固定欢迎语（如 `/cheer-text 哥哥，欢迎回家`）；`off` 清除 |
| `/sister` | 查看状态：朗读开关 + 打气时间 + 固定文案 |

## 每日定时欢迎（自动变化 + 趣闻）

到点后，妹妹会**自己生成**一条欢迎问候：用 cheer 工具送上一句"欢迎回家"，再通过网络搜索分享一个今天的小趣闻/小新闻（每天都不一样），最后用 Qwen3-TTS 派蒙音朗读出来，并弹出 💛 卡片。

- 设时间：`/cheer-at 15:00`（可多个时间）
- 想要固定文案（不变化）：`/cheer-text 哥哥，欢迎回家`；清除用 `/cheer-text off`
- 调度在插件内部（宿主侧），与浏览器/前端无关——唯一要求是**到点时刻目标设备浏览器开着 DSH 标签页**，声音才会响起
- 每个时间每天触发一次；错过的时间直接跳过，不补发

## 音色风格（🎤 面板）

| 风格 | 说明 |
| --- | --- |
| ✨ 派蒙风（默认） | 撒娇稚嫩萝莉音，音调偏高起伏明显，像动画小精灵 |
| 🌸 软萌可爱 | 温柔甜美少女音，软糯撒娇 |
| ⚡ 元气少女 | 活泼清亮，语速稍快，阳光干劲 |
| 🎧 清冷御姐 | 清冷柔和，语速平缓优雅 |

点一下即用 Qwen3-TTS 生成并试听（几秒钟），自动记住最后选择。

## 测试

```bash
node --test test/*.test.js   # 34 tests
```

## License

MIT
