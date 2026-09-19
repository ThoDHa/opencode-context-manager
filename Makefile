PLUGIN_FILES := lru-context.ts lru-context.tui.tsx lru-panel-data.ts
PLUGIN_SRC := $(addprefix plugin/,$(PLUGIN_FILES))
PLUGIN_TARGET_DIR := $(HOME)/.config/opencode/plugin

.PHONY: all test install uninstall help

# Default target
all: test

# Run the plugin test suites
test:
	node --test tests/lru-context.test.ts tests/lru-panel-data.test.ts

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
	@echo "  make install   - Symlink the plugin files into ~/.config/opencode/plugin/"
	@echo "  make uninstall - Remove the plugin symlinks from ~/.config/opencode/plugin/"
	@echo "  make help      - Show this help"
