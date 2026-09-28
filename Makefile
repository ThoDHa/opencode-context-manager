PLUGIN_FILES := context-manager.ts context-manager.tui.tsx panel-data.ts schema.ts
PLUGIN_SRC := $(addprefix plugin/,$(PLUGIN_FILES))
PLUGIN_TARGET_DIR := $(HOME)/.config/opencode/plugin
TEST_FILES := tests/context-manager.test.ts tests/panel-data.test.ts tests/panel-rows.test.ts tests/sidebar-rows.test.ts tests/sidebar-subagents.test.ts

.PHONY: all test ci install uninstall help

# Default target
all: test

# Run the plugin test suites
test:
	node --test $(TEST_FILES)

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
	expected=$$(node --test $(TEST_FILES) | test_count); \
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
		out=$$(node --test $$file 2>&1); \
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

# Symlink the plugin files into the opencode plugin directory.
# Idempotent: existing symlinks are replaced in place; a regular file (or
# directory) occupying a target path aborts the install with an error.
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

# Remove the plugin symlinks from the opencode plugin directory.
# Only symlinks are removed; regular files are left untouched.
uninstall:
	@for file in $(PLUGIN_FILES); do \
		target=$(PLUGIN_TARGET_DIR)/$$file; \
		if [ -L "$$target" ]; then \
			rm "$$target"; \
			echo "  removed $$file"; \
		fi; \
	done
	@echo "Uninstalled plugin files from $(PLUGIN_TARGET_DIR)"

help:
	@echo "opencode-lru-context"
	@echo "===================="
	@echo ""
	@echo "  make test      - Run the plugin test suites (node --test)"
	@echo "  make ci        - Per-file CI guard: every suite loads, counts sum to the aggregate"
	@echo "  make install   - Symlink the plugin files into ~/.config/opencode/plugin/"
	@echo "  make uninstall - Remove the plugin symlinks from ~/.config/opencode/plugin/"
	@echo "  make help      - Show this help"
