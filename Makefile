ROOT := $(CURDIR)
# Website deployment secrets and private paths are loaded from .env below.
WEBSITE_SSH_OPTIONS = -o BatchMode=yes $(if $(WEBSITE_SSH_KEY),-i "$(WEBSITE_SSH_KEY)" -o IdentitiesOnly=yes)
WEBSITE_PACKAGE_TIMESTAMP := $(shell date +%Y%m%d-%H%M%S)
WEBSITE_PACKAGE ?= $(ROOT)/.tmp/dsh-connect-website-$(WEBSITE_PACKAGE_TIMESTAMP).tar.gz
WEBSITE_REMOTE_PACKAGE ?= /tmp/$(notdir $(WEBSITE_PACKAGE))
# bsdtar on macOS emits Apple provenance xattrs; strip them when supported.
WEBSITE_TAR_METADATA_FLAGS := $(shell tar --no-mac-metadata --no-xattrs -cf /dev/null --files-from /dev/null >/dev/null 2>&1 && printf '%s' '--no-mac-metadata --no-xattrs')
export GOCACHE ?= $(ROOT)/.tmp/go-build
export GOMODCACHE ?= $(ROOT)/.tmp/go-mod
export NPM_CONFIG_CACHE ?= $(ROOT)/.tmp/npm-cache
# Local mirrors: proxy.golang.org is unreachable on some networks.
export GOPROXY ?= https://goproxy.cn,direct

# Load local configuration (.env) and export it to every recipe.
ifneq (,$(wildcard $(ROOT)/.env))
include $(ROOT)/.env
export DSH_CONNECT_BOOTSTRAP_TOKEN DSH_CONNECT_LISTEN_ADDR \
	DSH_CONNECT_SERVER_URL DSH_CONNECT_TLS_CERT_FILE DSH_CONNECT_TLS_KEY_FILE \
	DSH_CONNECT_URL DSH_CONNECT_TOKEN DSH_CONNECT_STATE_FILE \
	DSH_CONNECT_DATABASE_URL DSH_CONNECT_ADMIN_ORIGIN \
	DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD \
	DSH_CONNECT_BOOTSTRAP_OWNER_NAME
endif

.PHONY: help db-up db-down db-reset test test-server test-connector test-e2e \
	test-admin test-mobile vet check run-server run-admin run-mobile admin-install \
	admin-build website-deploy website-deploy-check mobile-install mobile-build ent-gen \
	ent-upgrade-check

help:
	@echo "db-up          启动 PostgreSQL 18（docker compose）"
	@echo "db-down        停止数据库，保留数据卷"
	@echo "db-reset       停止数据库并删除数据卷（破坏性）"
	@echo "run-server     启动 Go Server（自动执行 ent 迁移与 Owner 引导）"
	@echo "run-admin      启动管理后台开发服务器（Vite）"
	@echo "run-mobile     启动 Expo Metro（需先安装 Development Build）"
	@echo "test           全部既有测试（Server + Connector）"
	@echo "check          vet + 全部测试 + 跨语言 E2E + Web/Mobile 静态检查"
	@echo "ent-gen        修改 ent/schema 后重新生成实体代码"
	@echo "ent-upgrade-check 检查 ent 是否已发布含 Go 1.27 修复的正式版"
	@echo "website-deploy 编译 Website，使用 SSH 密钥通过 SCP 部署到 lxy.app"

# ---------- 数据库 ----------

db-up:
	docker-compose up -d
	@echo "等待 PostgreSQL 就绪…"
	@until docker exec dsh-connect-postgres pg_isready -U dsh -d dsh_connect >/dev/null 2>&1; do sleep 1; done
	@echo "PostgreSQL 18 已就绪：postgres://dsh:dsh@127.0.0.1:5432/dsh_connect"

db-down:
	docker-compose down

db-reset:
	docker-compose down -v

# ---------- 测试 ----------

test: test-server test-connector

# Server 测试会自行拉起临时 PostgreSQL 容器；设置
# DSH_CONNECT_TEST_DATABASE_URL 可复用已有实例，DSH_CONNECT_REQUIRE_PG=1 让
# 缺少 Docker 时失败而不是跳过。
test-server:
	go -C server test ./...

test-connector:
	npm --prefix connector/dsh-plugin test

test-e2e:
	npm --prefix connector/dsh-plugin run test:e2e

test-admin:
	npm --prefix apps/admin run typecheck

test-mobile:
	npm --prefix apps/mobile run check
	npm --prefix apps/mobile test

vet:
	go -C server vet ./...

check: vet test test-e2e test-admin test-mobile

# ---------- 运行 ----------

run-server:
	go -C server run ./cmd/server

admin-install:
	npm --prefix apps/admin install

run-admin:
	npm --prefix apps/admin run dev

admin-build:
	npm --prefix apps/admin run build

# Package and verify the static site, back up the current site, then upload once.
# BatchMode disables password prompts; WEBSITE_SSH_KEY optionally selects a key.
website-deploy-check:
	@if [ -z "$(strip $(WEBSITE_REMOTE))" ] || [ -z "$(strip $(WEBSITE_REMOTE_DIR))" ] || [ -z "$(strip $(WEBSITE_BACKUP_DIR))" ]; then \
		printf '%s\n' 'Missing website deployment configuration. Set WEBSITE_REMOTE, WEBSITE_REMOTE_DIR and WEBSITE_BACKUP_DIR in .env (see .env.example).'; \
		exit 1; \
	fi

website-deploy: website-deploy-check
	npm --prefix website run build
	mkdir -p "$(dir $(WEBSITE_PACKAGE))"
	cd "$(ROOT)/website/out" && COPYFILE_DISABLE=1 tar $(WEBSITE_TAR_METADATA_FLAGS) -czf "$(WEBSITE_PACKAGE)" --exclude='._*' --exclude='.DS_Store' *
	tar -tzf "$(WEBSITE_PACKAGE)" >/dev/null
	ssh $(WEBSITE_SSH_OPTIONS) "$(WEBSITE_REMOTE)" 'set -eu; mkdir -p "$(WEBSITE_REMOTE_DIR)" "$(WEBSITE_BACKUP_DIR)"; test ! -e "$(WEBSITE_REMOTE_PACKAGE)"; if [ -n "$$(find "$(WEBSITE_REMOTE_DIR)" -mindepth 1 -maxdepth 1 -print -quit)" ]; then backup="$(WEBSITE_BACKUP_DIR)/dsh-connect-$$(date +%Y%m%d-%H%M%S).tar.gz"; test ! -e "$$backup"; tar -czf "$$backup" -C "$(WEBSITE_REMOTE_DIR)" .; printf "Remote backup: %s\n" "$$backup"; fi'
	scp $(WEBSITE_SSH_OPTIONS) "$(WEBSITE_PACKAGE)" "$(WEBSITE_REMOTE):$(WEBSITE_REMOTE_PACKAGE)"
	ssh $(WEBSITE_SSH_OPTIONS) "$(WEBSITE_REMOTE)" 'set -eu; package="$(WEBSITE_REMOTE_PACKAGE)"; trap "rm -f \"$$package\"" EXIT; tar --no-same-owner --no-same-permissions -xzf "$$package" -C "$(WEBSITE_REMOTE_DIR)"; test -f "$(WEBSITE_REMOTE_DIR)/index.html"; test -d "$(WEBSITE_REMOTE_DIR)/_next"; test -f "$(WEBSITE_REMOTE_DIR)/images/icon.png"'
	rm -f "$(WEBSITE_PACKAGE)"

mobile-install:
	npm --prefix apps/mobile install

run-mobile:
	npm --prefix apps/mobile start

mobile-build:
	npm --prefix apps/mobile run build:bundles

# ---------- 代码生成 ----------

ent-gen:
	# The generator version must match the entgo.io/ent version in server/go.mod.
	# It resolves through server/go.sum rather than ent's own go.sum, so the
	# generator is run in its isolated module context.
	go -C server run entgo.io/ent/cmd/ent@v0.14.7-0.20261014065818-8037bc89bcab generate \
		--feature sql/upsert,sql/execquery,sql/lock ./ent/schema
	gofmt -w server/ent