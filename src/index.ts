import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"

const DEFAULT_IMAGE_INCAPABLE_MODELS = [
  "zai-coding-plan/glm-4.5",
  "zai-coding-plan/glm-4.5-air",
  "zai-coding-plan/glm-4.5-flash",
  "zai-coding-plan/glm-4.6",
  "zai-coding-plan/glm-4.7",
  "zai-coding-plan/glm-4.7-flash",
  "zai-coding-plan/glm-5",
]

const DEFAULT_ANALYSIS_PROMPT = `The user has pasted an image into their chat. Describe what you see as if you are directly observing the image. Be thorough but concise. Include:
- All visible elements (objects, text, UI elements, people, etc.)
- Exact transcription of any text
- The context and purpose of the image
- Any relevant technical details

Describe it naturally, as if explaining to someone what you're looking at right now.`

const IMAGE_WRAPPER_PREFIX = `[User pasted image: `
const IMAGE_WRAPPER_SUFFIX = `]`

interface Config {
  imageIncapableModels: string[]
  imageReaderModel: { providerID: string; modelID: string }
  analysisPrompt: string
}

interface Part {
  id?: string
  type: string
  mime?: string
  url?: string
  text?: string
  filename?: string
  messageID?: string
  sessionID?: string
  [key: string]: unknown
}

type UserConfig = Partial<{
  imageIncapableModels: unknown
  imageReaderModel: { providerID?: unknown; modelID?: unknown }
  analysisPrompt: unknown
}>

let config: Config | null = null
let pluginContext: PluginInput | null = null
const pendingAnalyses = new Map<string, Promise<{ updatedPart: Part }>>()

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  return join(xdgConfig ?? join(homedir(), ".config"), "opencode")
}

function getDefaultConfig(): Config {
  return {
    imageIncapableModels: DEFAULT_IMAGE_INCAPABLE_MODELS,
    imageReaderModel: { providerID: "opencode", modelID: "kimi-k2.5-free" },
    analysisPrompt: DEFAULT_ANALYSIS_PROMPT,
  }
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : fallback
  return raw.filter(isNonEmptyString).map((entry) => entry.trim())
}

function normalizeReaderModel(value: unknown, fallback: Config["imageReaderModel"]): Config["imageReaderModel"] {
  if (!value || typeof value !== "object") return fallback
  const candidate = value as { providerID?: unknown; modelID?: unknown }
  const providerID = isNonEmptyString(candidate.providerID) ? candidate.providerID.trim() : fallback.providerID
  const modelID = isNonEmptyString(candidate.modelID) ? candidate.modelID.trim() : fallback.modelID
  return { providerID, modelID }
}

function loadConfig(): Config {
  const configPath = join(getConfigDir(), "opencode-image-proxy.json")
  const defaultConfig = getDefaultConfig()

  if (!existsSync(configPath)) {
    return defaultConfig
  }

  try {
    const userConfig = JSON.parse(readFileSync(configPath, "utf-8")) as UserConfig
    return {
      imageIncapableModels: normalizeStringArray(userConfig.imageIncapableModels, defaultConfig.imageIncapableModels),
      imageReaderModel: normalizeReaderModel(userConfig.imageReaderModel, defaultConfig.imageReaderModel),
      analysisPrompt: isNonEmptyString(userConfig.analysisPrompt) ? userConfig.analysisPrompt : defaultConfig.analysisPrompt,
    }
  } catch {
    return defaultConfig
  }
}

function isImageIncapableModel(providerID?: string, modelID?: string): boolean {
  if (!providerID || !modelID) return false
  return (config ??= loadConfig()).imageIncapableModels.includes(`${providerID}/${modelID}`)
}

function getMimeFromDataUrl(url: string): string | null {
  const match = url.match(/^data:([^;,]+)(?:;[^,]+)?;base64,/)
  return match ? match[1].toLowerCase() : null
}

function getPendingKey(sessionID: string, messageID: string, partID: string): string {
  return `${sessionID}:${messageID}:${partID}`
}

async function analyzeImageViaOpencode(imageDataUrl: string, filename?: string, mime?: string): Promise<string> {
  if (!pluginContext) {
    return "[Image analysis failed: plugin context not initialized]"
  }

  const cfg = config ??= loadConfig()
  const { client } = pluginContext
  const resolvedMime = mime ?? getMimeFromDataUrl(imageDataUrl) ?? "image/png"

  try {
    const session = await client.session.create({})
    if (!session.data) {
      return "[Image analysis failed: could not create session]"
    }

    const sessionID = session.data.id

    const response = await client.session.prompt({
      path: { id: sessionID },
      body: {
        model: cfg.imageReaderModel,
        system: cfg.analysisPrompt,
        parts: [
          { type: "text", text: "What do you see in this image?" },
          {
            type: "file",
            url: imageDataUrl,
            filename: filename ?? "image.png",
            mime: resolvedMime,
          },
        ],
      },
    })

    await client.session.delete({ path: { id: sessionID } }).catch(() => {})

    if (!response.data) {
      return "[Image analysis failed: no response from vision model]"
    }

    const textParts = (response.data.parts ?? []).filter((p: Part) => p.type === "text" && p.text)
    if (textParts.length === 0) {
      return "[Image analysis failed: no text in response]"
    }

    return textParts.map((p: Part) => p.text).join("\n")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return `[Image analysis failed: ${errorMsg}]`
  }
}

async function updatePartInDB(part: Part): Promise<void> {
  if (!pluginContext || !part.id || !part.messageID || !part.sessionID) return

  const { serverUrl } = pluginContext
  const url = new URL(`/session/${part.sessionID}/message/${part.messageID}/part/${part.id}`, serverUrl)

  try {
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(part),
    })
  } catch {
    // Silently fail - the transformation will still work for this request
  }
}

export const OpencodeVisionPlugin: Plugin = async (ctx) => {
  pluginContext = ctx
  config = loadConfig()

  return {
    "chat.message": async (
      input: { sessionID: string; messageID?: string; model?: { providerID?: string; modelID?: string } },
      output: { parts: Part[] }
    ) => {
      if (!isImageIncapableModel(input.model?.providerID, input.model?.modelID)) return
      if (!output.parts?.length) return

      const messageID = input.messageID
      if (!messageID) return

      for (let i = 0; i < output.parts.length; i++) {
        const part = output.parts[i]
        if (part.type === "file" && part.mime?.startsWith("image/") && part.url && part.id) {
          const key = getPendingKey(input.sessionID, messageID, part.id)
          const promise = analyzeImageViaOpencode(part.url, part.filename, part.mime).then(async (analysis) => {
            const displayName = part.filename ?? `image.${part.mime?.split("/")[1] ?? "bin"}`
            const updatedPart: Part = {
              ...part,
              type: "text",
              text: `${IMAGE_WRAPPER_PREFIX}${displayName}${IMAGE_WRAPPER_SUFFIX}\n${analysis}`,
            }
            delete updatedPart.url
            delete updatedPart.mime
            await updatePartInDB(updatedPart)
            return { updatedPart }
          })
          pendingAnalyses.set(key, promise)
        }
      }
    },

    "experimental.chat.messages.transform": async (
      _: unknown,
      output: { messages: { info?: { id?: string; sessionID?: string }; parts: Part[] }[] }
    ) => {
      if (!output?.messages) return

      for (const msg of output.messages) {
        if (!msg.parts) continue
        const sessionID = msg.info?.sessionID
        const messageID = msg.info?.id
        if (!sessionID || !messageID) continue

        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i]
          if (part.type === "file" && part.mime?.startsWith("image/") && part.id) {
            const key = getPendingKey(sessionID, messageID, part.id)
            const pending = pendingAnalyses.get(key)
            if (pending) {
              const { updatedPart } = await pending
              msg.parts[i] = updatedPart
            }
          }
        }
      }
    },
  }
}

export default OpencodeVisionPlugin
