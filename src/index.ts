import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"

const DEFAULT_IMAGE_INCAPABLE_MODELS = [
  "zai-coding-plan/glm-4.5",
  "zai-coding-plan/glm-4.5-air",
  "zai-coding-plan/glm-4.5-flash",
  "zai-coding-plan/glm-4.5v",
  "zai-coding-plan/glm-4.6",
  "zai-coding-plan/glm-4.6v",
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
  type: string
  mime?: string
  url?: string
  text?: string
  filename?: string
  [key: string]: unknown
}

const sessionsNeedingAnalysis = new Set<string>()
let config: Config | null = null
let pluginContext: PluginInput | null = null

function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  if (xdgConfig) {
    return join(xdgConfig, "opencode")
  }
  return join(homedir(), ".config", "opencode")
}

function loadConfig(): Config {
  const configPath = join(getConfigDir(), "opencode-image-proxy.json")
  const defaultConfig: Config = {
    imageIncapableModels: DEFAULT_IMAGE_INCAPABLE_MODELS,
    imageReaderModel: { providerID: "github-copilot", modelID: "gpt-5-mini" },
    analysisPrompt: DEFAULT_ANALYSIS_PROMPT,
  }

  if (!existsSync(configPath)) {
    return defaultConfig
  }

  try {
    const userConfig = JSON.parse(readFileSync(configPath, "utf-8"))
    return {
      imageIncapableModels: Array.isArray(userConfig.imageIncapableModels)
        ? userConfig.imageIncapableModels.filter((m: unknown) => typeof m === "string")
        : DEFAULT_IMAGE_INCAPABLE_MODELS,
      imageReaderModel: userConfig.imageReaderModel
        ? {
            providerID: userConfig.imageReaderModel.providerID ?? defaultConfig.imageReaderModel.providerID,
            modelID: userConfig.imageReaderModel.modelID ?? defaultConfig.imageReaderModel.modelID,
          }
        : defaultConfig.imageReaderModel,
      analysisPrompt: typeof userConfig.analysisPrompt === "string" ? userConfig.analysisPrompt : DEFAULT_ANALYSIS_PROMPT,
    }
  } catch {
    return defaultConfig
  }
}

function isImageIncapableModel(providerID?: string, modelID?: string): boolean {
  if (!providerID || !modelID) return false
  return (config ??= loadConfig()).imageIncapableModels.includes(`${providerID}/${modelID}`)
}

function decodeDataUrl(url: string): { data: Buffer; mime: string } | null {
  const match = url.match(/^data:([^;,]+)(?:;[^,]+)?;base64,(.+)$/)
  if (!match) return null
  try {
    const data = Buffer.from(match[2], "base64")
    return data.length ? { data, mime: match[1].toLowerCase() } : null
  } catch {
    return null
  }
}

async function analyzeImageViaOpencode(imageDataUrl: string, filename?: string): Promise<string> {
  if (!pluginContext) {
    return "[Image analysis failed: plugin context not initialized]"
  }

  const cfg = config ??= loadConfig()
  const { client } = pluginContext

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
          {
            type: "text",
            text: "What do you see in this image?",
          },
          {
            type: "file",
            url: imageDataUrl,
            filename: filename ?? "image.png",
            mime: "image/png",
          },
        ],
      },
    })

    await client.session.delete({ path: { id: sessionID } }).catch(() => {})

    if (!response.data) {
      return "[Image analysis failed: no response from vision model]"
    }

    const parts = response.data.parts ?? []
    const textParts = parts.filter((p: Part) => p.type === "text" && p.text)
    if (textParts.length === 0) {
      return "[Image analysis failed: no text in response]"
    }

    return textParts.map((p: Part) => p.text).join("\n")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return `[Image analysis failed: ${errorMsg}]`
  }
}

export const ZaiVisionPlugin: Plugin = async (ctx) => {
  pluginContext = ctx
  config = loadConfig()

  return {
    "chat.message": async (input: { sessionID: string; model?: { providerID?: string; modelID?: string } }) => {
      if (isImageIncapableModel(input.model?.providerID, input.model?.modelID)) {
        sessionsNeedingAnalysis.add(input.sessionID)
      } else if (input.model?.providerID || input.model?.modelID) {
        sessionsNeedingAnalysis.delete(input.sessionID)
      }
    },

    "experimental.chat.messages.transform": async (_: unknown, output: { messages: { info?: { sessionID?: string; role?: string }; parts: Part[] }[] }) => {
      if (!output?.messages) return

      let lastUserMsgIdx = -1
      for (let i = output.messages.length - 1; i >= 0; i--) {
        if (output.messages[i].info?.role === "user") {
          lastUserMsgIdx = i
          break
        }
      }
      if (lastUserMsgIdx === -1) return

      const msg = output.messages[lastUserMsgIdx]
      if (!msg?.parts) return

      const sid = msg.info?.sessionID
      if (!sid || !sessionsNeedingAnalysis.has(sid)) return

      const imageAnalysisPromises: Promise<{ index: number; analysis: string; filename?: string }>[] = []

      for (let i = 0; i < msg.parts.length; i++) {
        const p = msg.parts[i]
        if (p.type === "file" && p.mime?.startsWith("image/") && p.url) {
          const index = i
          const filename = p.filename
          const imageUrl = p.url
          imageAnalysisPromises.push(
            analyzeImageViaOpencode(imageUrl, filename).then((analysis) => ({
              index,
              analysis,
              filename,
            }))
          )
        }
      }

      if (imageAnalysisPromises.length === 0) return

      const results = await Promise.all(imageAnalysisPromises)

      for (const { index, analysis, filename } of results) {
        const p = msg.parts[index]
        const displayName = filename ?? `image.${p.mime?.split("/")[1] ?? "bin"}`
        const textPart: Part = {
          type: "text",
          text: `${IMAGE_WRAPPER_PREFIX}${displayName}${IMAGE_WRAPPER_SUFFIX}\n${analysis}`,
        }
        msg.parts[index] = textPart
      }
    },
  }
}

export default ZaiVisionPlugin
