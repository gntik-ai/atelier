<p align="center">
  <img src="logo.svg" alt="In Falcone" width="200" />
</p>

<h1 align="center">In Falcone</h1>

<p align="center">
  自托管多租户后端即服务平台
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Espa&ntilde;ol</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.zh.md">中文</a>
</p>

---

**In Falcone** 是一个自托管的多租户后端即服务（BaaS）平台，提供托管数据库、身份认证、无服务器函数、事件流和对象存储——所有功能均通过单个 Helm Chart 部署在您自己的 Kubernetes 或 OpenShift 基础设施上。

平台以分层模型组织资源——平台、租户、工作区——内置计划治理、配额执行和上下文授权。每个工作区都获得隔离的 PostgreSQL Schema（带 RLS）、MongoDB 数据库、Kafka Topic、OpenWhisk 命名空间和 S3 存储桶路径，所有资源均通过幂等编排引擎自动配置。

平台配备 APISIX API 网关（OIDC 认证、速率限制、幂等性、CORS）、基于 Keycloak 的 IAM 层（每租户独立 Realm）、React 管理控制台、基于 CDC Bridge 的实时 WebSocket 订阅、完整的审计管道（带关联追踪）以及通过 External Secrets Operator 实现的 Vault 密钥管理。

部署采用声明式分层方式：选择配置文件（all-in-one、standard、HA）、环境（dev、staging、prod）和目标平台（Kubernetes、OpenShift、离线部署）——将它们组合为 Helm 值覆盖层并部署。

## 文档

完整文档请访问 **[gntik-ai.github.io/falcone](https://gntik-ai.github.io/falcone/)**。

## 仓库结构

```text
apps/
  control-plane/          # 平台 API 后端（Node.js 20+ ESM）
  web-console/            # 管理界面（React 18 + Vite + Tailwind）
services/
  adapters/               # 提供商适配器（Keycloak、PG、Mongo、Kafka、OW、S3）
  internal-contracts/     # 机器可读的 JSON Schema 和契约
  provisioning-orchestrator/  # 租户/工作区生命周期管理
  gateway-config/         # APISIX 路由定义和插件
  event-gateway/          # 事件发布桥接
  realtime-gateway/       # WebSocket 订阅服务器
  audit/                  # 审计事件处理管道
  backup-status/          # 备份监控服务
  pg-cdc-bridge/          # PostgreSQL 变更数据捕获
  mongo-cdc-bridge/       # MongoDB 变更数据捕获
charts/
  in-falcone/             # Umbrella Helm Chart
docs/                     # ADR 和内部参考
tests/                    # 单元测试、契约测试、E2E、弹性、加固测试
```

## 快速开始

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone

helm dependency build charts/in-falcone

helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/all-in-one.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

## 质量保障

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
```

## 许可证

[MIT](LICENSE)

---

<p align="center">
  <i>以 <b>乔瓦尼·法尔科内</b>（1939–1992）命名，这位意大利法官为正义献出了生命。</i>
</p>
