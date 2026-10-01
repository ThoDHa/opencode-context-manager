export type TuiTheme = {
  primary: string
  warning: string
  success: string
  info: string
  text: string
  accent: string
}

export type TuiRoute = { name: string; params: Record<string, unknown> }

export type RecordedKeymapLayer = { commands: unknown[] }
export type RecordedSlotRegistration = { order: number; slots: Record<string, unknown> }
export type RecordedDialogSize = { size: string }
export type RecordedDialogReplace = { renderer: unknown }
export type RecordedToast = { variant: string; title: string; message: string }
export type RecordedChildrenFetch = { sessionID: string }
export type RecordedPluginDeactivate = { pluginID: string }

// One color per theme key so a mis-mapped tone is visible in assertions
// instead of hiding behind two identical strings.
export const MOCK_THEME: TuiTheme = {
  primary: "#mock-primary",
  warning: "#mock-warning",
  success: "#mock-success",
  info: "#mock-info",
  text: "#mock-text",
  accent: "#mock-accent",
}

export type TuiApi = {
  theme: { current: TuiTheme }
  route: { current: TuiRoute }
  keymap?: { registerLayer: (layer: RecordedKeymapLayer) => void }
  slots?: { register: (registration: RecordedSlotRegistration) => void }
  plugins?: { deactivate: (pluginID: string) => void }
  ui: {
    dialog: { setSize: (size: string) => void; replace: (renderer: unknown) => void }
    toast: (options: RecordedToast) => void
  }
  client: { session: { children: (query: { sessionID: string }) => Promise<unknown> } }
}

export type TuiApiMock = {
  api: TuiApi
  calls: {
    keymapRegisterLayer: RecordedKeymapLayer[]
    slotsRegister: RecordedSlotRegistration[]
    dialogSetSize: RecordedDialogSize[]
    dialogReplace: RecordedDialogReplace[]
    toast: RecordedToast[]
    children: RecordedChildrenFetch[]
    pluginsDeactivate: RecordedPluginDeactivate[]
  }
  setSessionRoute: (sessionID: string) => void
  setNonSessionRoute: (name?: string) => void
  serveChildren: (result: unknown) => void
  rejectChildren: (error?: unknown) => void
}

// The host hands registrations to the mock as unknown at the boundary; these
// structural types narrow them for suite assertions.
export type RegisteredCommand = {
  namespace: string
  name: string
  title: string
  desc: string
  category: string
  slashName: string
  run: () => void
}

export type SidebarSlotRenderer = (ctx: unknown, props: { session_id: string }) => unknown

export type TuiEntryOptions = { sidebarEnabled?: unknown; sidebarSubagents?: unknown; sidebarMode?: unknown }

export type TuiEntry = (api: TuiApi, options?: TuiEntryOptions) => Promise<void>

export type TuiPluginEntry = { id: string; tui: TuiEntry }

export const EXPECTED_DIALOG_SIZE = "large"

// Guard-path options: omitting keymap, slots, or plugins drops the property
// entirely, so canRegisterKeymap/canRegisterSidebar/canDeactivatePlugins go
// false the same way they do against a host build without those registries.
export type TuiApiMockOptions = { omitKeymap?: boolean; omitSlots?: boolean; omitPlugins?: boolean }

const DEFAULT_ROUTE_NAME = "home"
const DEFAULT_CHILDREN_RESULT = { data: [] }

export const createTuiApiMock = ({ omitKeymap = false, omitSlots = false, omitPlugins = false }: TuiApiMockOptions = {}): TuiApiMock => {
  const calls = {
    keymapRegisterLayer: [] as RecordedKeymapLayer[],
    slotsRegister: [] as RecordedSlotRegistration[],
    dialogSetSize: [] as RecordedDialogSize[],
    dialogReplace: [] as RecordedDialogReplace[],
    toast: [] as RecordedToast[],
    children: [] as RecordedChildrenFetch[],
    pluginsDeactivate: [] as RecordedPluginDeactivate[],
  }
  let childrenHandler: (query: { sessionID: string }) => Promise<unknown> = async () => DEFAULT_CHILDREN_RESULT

  const api: TuiApi = {
    theme: { current: { ...MOCK_THEME } },
    route: { current: { name: DEFAULT_ROUTE_NAME, params: {} } as TuiRoute },
    ...(omitKeymap
      ? {}
      : {
          keymap: {
            registerLayer: (layer: RecordedKeymapLayer): void => {
              calls.keymapRegisterLayer.push(layer)
            },
          },
        }),
    ...(omitSlots
      ? {}
      : {
          slots: {
            register: (registration: RecordedSlotRegistration): void => {
              calls.slotsRegister.push(registration)
            },
          },
        }),
    ...(omitPlugins
      ? {}
      : {
          plugins: {
            deactivate: (pluginID: string): void => {
              calls.pluginsDeactivate.push({ pluginID })
            },
          },
        }),
    ui: {
      dialog: {
        setSize: (size: string): void => {
          calls.dialogSetSize.push({ size })
        },
        replace: (renderer: unknown): void => {
          calls.dialogReplace.push({ renderer })
        },
      },
      toast: (options: RecordedToast): void => {
        calls.toast.push(options)
      },
    },
    client: {
      session: {
        children: async (query: { sessionID: string }): Promise<unknown> => {
          calls.children.push({ sessionID: query.sessionID })
          return childrenHandler(query)
        },
      },
    },
  }

  return {
    api,
    calls,
    setSessionRoute: (sessionID: string): void => {
      api.route.current = { name: "session", params: { sessionID } }
    },
    setNonSessionRoute: (name: string = DEFAULT_ROUTE_NAME): void => {
      api.route.current = { name, params: {} }
    },
    serveChildren: (result: unknown): void => {
      childrenHandler = async () => result
    },
    rejectChildren: (error?: unknown): void => {
      childrenHandler = async () => {
        throw error === undefined ? new Error("children fetch rejected") : error
      }
    },
  }
}
