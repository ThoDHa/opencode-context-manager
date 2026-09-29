/** @jsxImportSource @opentui/solid */

// Neither external specifier below is resolved from node_modules on purpose,
// because the deployed plugin's realpath sits outside any node_modules up-tree
// (the same constraint that forced context-manager.ts to register tools as plain
// definitions instead of calling tool() from @opencode-ai/plugin). The
// TuiPluginApi import is type-only, so the transpiler erases it. The solid-js
// import (signals and lifecycle for the sidebar entry) and the @opentui/solid
// JSX runtime need no install either: opencode's TUI loads plugin files under
// a Bun transform plugin (@opentui/solid's ensureRuntimePluginSupport) that
// rewrites @opentui/solid and solid-js specifiers to the TUI's internal
// runtime modules for every file outside node_modules.
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup, onMount } from "solid-js"
import {
  canRegisterKeymap,
  canRegisterSidebar,
  createMetricsLogReader,
  DEFAULT_METRICS_PATH,
  filterSubagentChildren,
  loadPanelData,
  PANEL_COMMAND_CATEGORY,
  PANEL_COMMAND_DESCRIPTION,
  PANEL_COMMAND_NAME,
  PANEL_COMMAND_NAMESPACE,
  PANEL_COMMAND_SLASH_NAME,
  PANEL_COMMAND_TITLE,
  panelRows,
  resolveSidebarEnabled,
  resolveSidebarSubagents,
  resolveSubagentChildren,
  sidebarRows,
  sidebarSubagentsGroup,
  type PanelData,
  type PanelRow,
  type PanelRowTone,
  type SubagentChild,
} from "./panel-data.ts"
import { PLUGIN_ID } from "./schema.ts"

const DIALOG_SIZE = "large"
const SIDEBAR_SLOT_ORDER = 600
const SIDEBAR_REFRESH_MS = 5000

type PanelProps = { api: TuiPluginApi; data: PanelData }

const toneColor = (api: TuiPluginApi, tone: PanelRowTone) => {
  const theme = api.theme.current
  if (tone === "header") return theme.primary
  if (tone === "muted") return theme.textMuted
  if (tone === "warning") return theme.warning
  if (tone === "success") return theme.success
  if (tone === "info") return theme.info
  if (tone === "secondary") return theme.secondary
  if (tone === "accent") return theme.accent
  return theme.text
}

type RowsViewProps = { api: TuiPluginApi; rows: PanelRow[] }

const RowsView = (props: RowsViewProps) => (
  <box flexDirection="column">
    {props.rows.map((row) => (
      <text fg={toneColor(props.api, row.tone)}>{row.text}</text>
    ))}
  </box>
)

const PanelDialog = (props: PanelProps) => (
  <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
    <RowsView api={props.api} rows={panelRows(props.data)} />
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
    api.ui.toast({ variant: "error", title: PANEL_COMMAND_TITLE, message: `panel failed to open: ${message}` })
  })
}

const subagentChildrenOf = async (api: TuiPluginApi, sessionID: string): Promise<SubagentChild[]> => {
  try {
    // resolveSubagentChildren guards the fetch result and each child's shape,
    // but the children call itself (and whether api.client.session.children
    // even exists on this host build) lives here: the whole body stays guarded
    // so this tick degrades to a group-less sidebar instead of blanking one.
    const result = await api.client.session.children({ sessionID })
    return await resolveSubagentChildren(result)
  } catch {
    return []
  }
}

type SidebarEntryProps = { api: TuiPluginApi; sessionID: string; subagentsEnabled: boolean }

const SidebarEntry = (props: SidebarEntryProps) => {
  const [rows, setRows] = createSignal<PanelRow[]>([])
  let disposed = false
  onMount(() => {
    // One incremental reader across the component's ticks: each poll stats
    // the log and parses only appended bytes; rotation or shrink falls
    // back to a full re-read inside the reader.
    const reader = createMetricsLogReader(DEFAULT_METRICS_PATH)
    const refresh = async (): Promise<void> => {
      let next: PanelRow[] = []
      try {
        const children = props.subagentsEnabled ? await subagentChildrenOf(props.api, props.sessionID) : []
        // Pre-filter before the loader so archived children cost no snapshot
        // reads; what renders is the builder's call over all fetched children.
        const kept = filterSubagentChildren(children)
        const childSessionIDs = kept.length > 0 ? kept.map((child) => child.id) : undefined
        const data = await loadPanelData({ sessionID: props.sessionID, childSessionIDs, reader })
        if (data.current !== undefined) {
          next = sidebarRows(data, sidebarSubagentsGroup(children, data))
        }
      } catch {
        // Startup and log rotation produce transient read failures; hide the
        // entry for that tick and let the next poll repaint it.
      }
      if (!disposed) setRows(next)
    }
    void refresh()
    const poll = setInterval(() => void refresh(), SIDEBAR_REFRESH_MS)
    onCleanup(() => {
      disposed = true
      clearInterval(poll)
    })
  })
  return <RowsView api={props.api} rows={rows()} />
}

const tui: TuiPluginModule["tui"] = async (api, options) => {
  if (canRegisterKeymap(api)) {
    api.keymap.registerLayer({
      commands: [
        {
          namespace: PANEL_COMMAND_NAMESPACE,
          name: PANEL_COMMAND_NAME,
          title: PANEL_COMMAND_TITLE,
          desc: PANEL_COMMAND_DESCRIPTION,
          category: PANEL_COMMAND_CATEGORY,
          slashName: PANEL_COMMAND_SLASH_NAME,
          run: () => {
            openPanelSafely(api)
          },
        },
      ],
    })
  }
  if (resolveSidebarEnabled(options?.sidebarEnabled) && canRegisterSidebar(api)) {
    const subagentsEnabled = resolveSidebarSubagents(options?.sidebarSubagents)
    api.slots.register({
      order: SIDEBAR_SLOT_ORDER,
      slots: {
        sidebar_content: (_ctx, props) => <SidebarEntry api={api} sessionID={props.session_id} subagentsEnabled={subagentsEnabled} />,
      },
    })
  }
}

export default { id: PLUGIN_ID, tui } satisfies TuiPluginModule
