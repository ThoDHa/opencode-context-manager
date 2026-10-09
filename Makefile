PLUGIN_FILES := context-manager.ts context-manager.tui.tsx panel-data.ts schema.ts summaries.ts context-limits.ts messages.ts options.ts session-maps.ts vocabulary.ts state.ts persistence.ts page-store.ts dedup.ts hygiene.ts fences.ts eviction.ts hints.ts tools.ts pipeline.ts
PLUGIN_SRC := $(addprefix plugin/,$(PLUGIN_FILES))
PLUGIN_TARGET_DIR := $(HOME)/.config/opencode/context-manager
TUI_HOOK := $(CURDIR)/tests/tui/hooks.mjs
NODE_TEST_ENV := NODE_OPTIONS="--import $(TUI_HOOK)"
TEST_FILES := tests/context-manager.test.ts tests/panel-data.test.ts tests/panel-rows.test.ts tests/sidebar-rows.test.ts tests/sidebar-subagents.test.ts tests/tui-harness.test.ts tests/tui-registration.test.ts tests/tui-panel.test.ts tests/tui-sidebar.test.ts tests/summaries.test.ts tests/integration/ab/ab-apparatus.test.ts

ABX_BIN_DIR := $(HOME)/.local/bin
ABX_SHARE_DIR := $(HOME)/.local/share/opencode

.PHONY: all test ci install uninstall ab-install ab-uninstall help

# Default target
all: test

# Run the plugin test suites
test:
	$(NODE_TEST_ENV) node --test $(TEST_FILES)

# CI guard: run each suite file in its own node --test invocation, require
# every invocation to exit 0 and to report at least one test, and require
# the per-file totals to sum to the aggregate `make test` total. A suite
# file that fails to load (a syntax error, a duplicate import) makes its
# node --test run exit non-zero and drops its tests from the aggregate
# output while the rest still looks green; running files separately makes
# that failure loud instead of silent.
ci:
	@test_count() { grep -E '^[^0-9]*tests [0-9]+[[:space:]]*$$' | grep -o '[0-9]*' | tail -n 1; }; \
	total=0; \
	expected=$$(env $(NODE_TEST_ENV) node --test $(TEST_FILES) | test_count); \
	if [ -z "$$expected" ]; then \
		echo "FAIL: aggregate run produced no measurable test count" >&2; \
		exit 1; \
	fi; \
	case "$$expected" in \
		*[!0-9]*) \
			echo "FAIL: aggregate run produced a non-numeric test count: $$expected" >&2; \
			exit 1; \
			;; \
	esac; \
	for file in $(TEST_FILES); do \
		out=$$(env $(NODE_TEST_ENV) node --test $$file 2>&1); \
		status=$$?; \
		count=$$(printf '%s\n' "$$out" | test_count); \
		if [ "$$status" -ne 0 ]; then \
			echo "FAIL: $$file exited $$status" >&2; \
			printf '%s\n' "$$out" | tail -n 20 >&2; \
			exit 1; \
		fi; \
		if [ -z "$$count" ] || [ "$$count" -eq 0 ]; then \
			echo "FAIL: $$file reported no test count" >&2; \
			printf '%s\n' "$$out" | tail -n 20 >&2; \
			exit 1; \
		fi; \
		echo "  ok $$file ($$count tests)"; \
		total=$$((total + count)); \
	done; \
	if [ "$$expected" -ne "$$total" ]; then \
		echo "FAIL: aggregate count $$expected does not match per-file sum $$total" >&2; \
		exit 1; \
	fi; \
	echo "ci guard green: $$total tests across $(words $(TEST_FILES)) files"

# Symlink the plugin files into the plugin's own directory under the opencode
# config dir. The directory must not be named plugin/ or plugins/: opencode
# scans those for .ts/.js files, a scanned copy silently overrides the config
# tuple and drops its options, and helper modules found there are tried as
# pseudo-plugins, logging "failed to load plugin" errors. Idempotent:
# existing symlinks are replaced in place; a regular file (or directory)
# occupying a target path aborts the install with an error.
install:
	@mkdir -p $(PLUGIN_TARGET_DIR)
	@for src in $(PLUGIN_SRC); do \
		file=$${src#plugin/}; \
		target=$(PLUGIN_TARGET_DIR)/$$file; \
		if [ -e "$$target" ] && [ ! -L "$$target" ]; then \
			echo "ERROR: $$target exists and is not a symlink; remove it, then rerun 'make install'" >&2; \
			exit 1; \
		fi; \
		ln -sfn "$(CURDIR)/$$src" "$$target"; \
		echo "  linked $$file"; \
	done
	@echo "Installed plugin files to $(PLUGIN_TARGET_DIR)"

# Remove the plugin symlinks from the plugin's directory under the opencode
# config dir. Only symlinks are removed; regular files are left untouched.
uninstall:
	@for file in $(PLUGIN_FILES); do \
		target=$(PLUGIN_TARGET_DIR)/$$file; \
		if [ -L "$$target" ]; then \
			rm "$$target"; \
			echo "  removed $$file"; \
		fi; \
	done
	@echo "Uninstalled plugin files from $(PLUGIN_TARGET_DIR)"

# Symlink the A/B experiment framework's operational entry points into the
# user paths, mirroring make install: the runner CLI as opencode-abx, the
# exercise reset/verify/redcheck tool as opencode-abx-work, and the fixture
# template/reference trees into the opencode share dir under abx- prefixed
# names (distinct from the legacy bash apparatus's live directories).
# Idempotent like make install: existing symlinks are replaced in place; a
# regular file or directory at a target path aborts the install.
ab-install:
	@mkdir -p $(ABX_BIN_DIR) $(ABX_SHARE_DIR)
	@set -e; \
	link_abx() { \
		target_name=$$1; src_rel=$$2; \
		case "$${target_name}" in \
			abx-*) target=$(ABX_SHARE_DIR)/$${target_name} ;; \
			*) target=$(ABX_BIN_DIR)/$${target_name} ;; \
		esac; \
		src=$(CURDIR)/$${src_rel}; \
		if [ -e "$$target" ] && [ ! -L "$$target" ]; then \
			echo "ERROR: $$target exists and is not a symlink; remove it, then rerun 'make ab-install'" >&2; \
			exit 1; \
		fi; \
		ln -sfn "$$src" "$$target"; \
		echo "  linked $${target_name}"; \
	}; \
	link_abx opencode-abx experiments/cli.ts; \
	link_abx opencode-abx-work experiments/exercise-cli.ts; \
	link_abx abx-work-rotator-template experiments/fixtures/rotator/template; \
	link_abx abx-work-rotator-reference experiments/fixtures/rotator/reference; \
	link_abx abx-work-deep-template experiments/fixtures/deep/template; \
	link_abx abx-work-deep-reference experiments/fixtures/deep/reference
	@echo "Installed A/B experiment entry points to $(ABX_BIN_DIR) and $(ABX_SHARE_DIR)"

# Remove the A/B experiment framework's symlinks from the user paths. Only
# symlinks are removed; regular files or directories are left untouched.
ab-uninstall:
	@remove_abx() { \
		target_name=$$1; \
		case "$${target_name}" in \
			abx-*) full=$(ABX_SHARE_DIR)/$${target_name} ;; \
			*) full=$(ABX_BIN_DIR)/$${target_name} ;; \
		esac; \
		if [ -L "$$full" ]; then \
			rm "$$full"; \
			echo "  removed $${target_name}"; \
		fi; \
	}; \
	remove_abx opencode-abx; \
	remove_abx opencode-abx-work; \
	remove_abx abx-work-rotator-template; \
	remove_abx abx-work-rotator-reference; \
	remove_abx abx-work-deep-template; \
	remove_abx abx-work-deep-reference
	@echo "Uninstalled A/B experiment entry points from $(ABX_BIN_DIR) and $(ABX_SHARE_DIR)"

help:
	@echo "opencode-context-manager"
	@echo "===================="
	@echo ""
	@echo "  make test      - Run the plugin test suites (node --test with the TUI compile hook)"
	@echo "  make ci        - Per-file CI guard: every suite loads, counts sum to the aggregate"
	@echo "  make install   - Symlink the plugin files into $(PLUGIN_TARGET_DIR)/"
	@echo "  make uninstall - Remove the plugin symlinks from $(PLUGIN_TARGET_DIR)/"
	@echo "  make ab-install   - Symlink the A/B experiment entry points into ~/.local/bin and ~/.local/share/opencode"
	@echo "  make ab-uninstall - Remove the A/B experiment symlinks"
	@echo "  make help      - Show this help"
	@echo ""
	@echo "npm ci is a prerequisite for test targets: test dependencies are dev-only"
