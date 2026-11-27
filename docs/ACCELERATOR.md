---
status: current
audience: operator
purpose: public-side campus download mirror contract
---

# 校内文件加速站（公网侧）

公网主站始终是唯一业务数据库、审核入口和权威文件源。校内节点只保存**已过审
资料**的镜像，用于校园局域网下载加速，不承担上传和在线预览。

- 上传（文件、文字）全部直连主站：保留现有 EXIF 剥离、占位码转正、审核路由与
  自动过审规则。
- 预览全部在主站：PDF 前 3 页裁剪预览免配额，完整图片/文件预览按原有配额规则。
- 校内节点代码在独立仓库：`https://github.com/JingHT-BNU/bnusparks_accelerator`。

## 数据结构

- `Material.file_sync_direction`：`none / public_to_campus`
- `Material.file_sync_status`：`synced / pending / transferring / verifying / error`
- `Material.file_sha256`、`file_synced_at`
- `MaterialSyncTask`：公网→校内镜像任务，含状态、优先级、进度、租约、失败退避。
  - `next_retry_at`：失败后按 1m / 5m / 15m / 1h / 4h 退避；`attempts >= 5` 后停在
    `error` 等待人工处理。

镜像状态与审核状态相互独立：只有 `review_status == "approved"` 的资料才会入队；
待审/驳回资料不镜像。

## 公网接口

| 接口 | 用途 |
|---|---|
| `GET /api/accelerator/config/` | 前端读取加速站 URL/开关 |
| `POST /api/files/<id>/accelerate-ticket/` | 签发校内下载票据，不扣配额 |
| `GET /api/internal/accelerator/authorize/` | 校内 Nginx 回调鉴权/配额/计数 |
| `GET /api/internal/accelerator/tasks/?status=active&limit=20` | 轮询领取镜像任务 |
| `POST /api/internal/accelerator/tasks/<id>/start\|progress\|complete/` | 任务状态 |
| `GET /api/internal/accelerator/files/<id>/source/` | 校内 agent 拉取公网源文件 |
| `GET /api/internal/accelerator/manifest/` | 文件清单对账（ETag） |
| `POST /api/internal/accelerator/repair/` | 缺失文件补任务 |

所有 `/api/internal/` 接口要求 `X-Accelerator-Secret`；公网 Nginx 还必须限制
为校内出口 IP。示例见 `deploy/nginx/bnusparks.conf.example`。

## 公网配置

```text
BNUSPARKS_ACCELERATOR_URL="https://bnu.jort.top"
BNUSPARKS_ACCELERATOR_SECRET="与校内节点共享的随机长密钥"
BNUSPARKS_ACCELERATOR_TICKET_TTL="1800"
```

为空时保持单机行为。公网 CSP `connect-src` 需要加入加速站 origin（健康探测），
上传和预览都在主站，不需要放开 `img-src` / `frame-src`。Chrome PNA 还需要校内
健康端点返回 `Access-Control-Allow-Private-Network: true`。

PNA 还要求发起方是安全上下文：只有 HTTPS 或 `localhost`/`127.0.0.1` 可以访问
私网地址。用 `http://<公网域名>` 打开主站时浏览器会直接拦截，前端据此静默
判定加速站不可用（不探测、不报错），下载全部回退公网。

## 健康探测

校内 `/healthz` 必须返回固定 JSON：

```json
{"ok": true, "service": "bnusparks-accelerator"}
```

校园网未认证时 Captive Portal 会用 `200 text/html` 冒充成功，因此前端不能只看
HTTP 状态码，必须校验 `service` 字段；否则会把未认证页面当成加速站。

## 下载行为

- 已审核资料：普通下载按钮保持原样；加速站可达时前端自动换用校内 ticket URL。
- 校内缺文件：校内 Nginx 302 回公网 `?aticket=`，公网用同一 ticket 作为
  `request_id`，配额/下载量只计一次。
- 校内尚未镜像：下载直接 302 回公网，不需要前端灰显或 ETA。
- 公网故障时校内不本地放行，失败关闭。

票据在 TTL 内可重复使用（Range 请求与 302 回退会再次校验），配额与下载量由
`DownloadRecord.request_id` 唯一约束保证幂等。

## 同步 agent

- 每 10 秒轮询任务接口（环境变量可调），空闲时也不建立长连接；
- 下载完成后上报校内副本 SHA-256，公网重新计算源文件哈希并比对；
- 进度按 5–10MB 或 10 秒节流上报，避免 SQLite 高频写；
- 定期拉取 manifest 对账：补齐缺失文件、清理失效 `by-id` 链接；
- 孤儿文件在 manifest 中消失超过宽限期后清理，避免目录改码/删除留下的旧副本。

## 测试

`materials/tests/test_accelerator.py` 覆盖票据与撤销、内部授权幂等与配额、HTTP
源文件下载、任务生命周期、租约回收、失败退避与上限、仅过审入队、审核/恢复
触发镜像、`adopt_course_code` 不误触发，以及 manifest。
