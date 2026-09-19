/** @jsxImportSource @opentui/solid */

// Both external specifiers below avoid runtime resolution on purpose. The
// TuiPluginApi import is type-only, so the transpiler erases it; the stowed
// plugin's realpath sits outside any node_modules up-tree (the same
// constraint that forced lru-context.ts to register tools as plain
// definitions instead of calling tool() from @opencode-ai/plugin). The
// @opentui/solid JSX runtime needs no install either: opencode's TUI loads
// plugin files under a Bun transform plugin (@opentui/solid's
// ensureRuntimePluginSupport) that rewrites @opentui/solid and solid-js
// specifiers to the TUI's internal runtime modules for every file outside
// node_modules.
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { loadPanelData, panelRows, type PanelData, type PanelRowTone } from "./lru-panel-data.ts"

const PLUGIN_ID = "lru-context"
const COMMAND_NAMESPACE = "palette"
const COMMAND_NAME = "lru.panel"
const COMMAND_TITLE = "LRU context panel"
const COMMAND_DESCRIPTION = "Open the LRU context manager's session panel"
const COMMAND_CATEGORY = "LRU"
const SLASH_NAME = "lru"
const DIALOG_SIZE = "xlarge"

type PanelProps = { api: TuiPluginApi; data: PanelData }

const toneColor = (api: TuiPluginApi, tone: PanelRowTone) => {
  const theme = api.theme.current
  if (tone === "header") return theme.primary
  if (tone === "muted") return theme.textMuted
  if (tone === "warning") return theme.warning
  return theme.text
}

const PanelDialog = (props: PanelProps) => (
  <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
    {panelRows(props.data).map((row) => (
      <text fg={toneColor(props.api, row.tone)}>{row.text}</text>
    ))}
  </box>
)

const sessionIDFromRoute = (api: TuiPluginApi): string | undefined => {
  const route = api.route.current
  if (route.name !== "session") return undefined
  const sessionID = route.params.sessionID
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined
}

const openPanel = async (api: TuiPluginApi): Promise<void> => {
  const data = await loadPanelData({ sessionID: sessionIDFromRoute(api) })
  api.ui.dialog.setSize(DIALOG_SIZE)
  api.ui.dialog.replace(() => <PanelDialog api={api} data={data} />)
}

const openPanelSafely = (api: TuiPluginApi): void => {
  openPanel(api).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    api.ui.toast({ variant: "error", title: COMMAND_TITLE, message: `panel failed to open: ${message}` })
  })
}

const tui: TuiPluginModule["tui"] = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        namespace: COMMAND_NAMESPACE,
        name: COMMAND_NAME,
        title: COMMAND_TITLE,
        desc: COMMAND_DESCRIPTION,
        category: COMMAND_CATEGORY,
        slashName: SLASH_NAME,
        run: () => {
          openPanelSafely(api)
        },
      },
    ],
  })
}

export default { id: PLUGIN_ID, tui } satisfies TuiPluginModule
