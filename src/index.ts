import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { join } from "node:path"

interface VisionConfig {
  models: string[]
  imagePrefix: string
  instructions: string
}

const DEFAULT_CONFIG: VisionConfig = {
  models: [
    "zai-coding-plan/glm-4.5",
    "zai-coding-plan/glm-4.5-air",
    "zai-coding-plan/glm-4.5-flash",
    "zai-coding-plan/glm-4.5v",
    "zai-coding-plan/glm-4.6",
    "zai-coding-plan/glm-4.6v",
    "zai-coding-plan/glm-4.7",
    "zai-coding-plan/glm-4.7-flash",
    "zai-coding-plan/glm-5",
  ],
  imagePrefix: "[Image at: {path}]",
  instructions: `When you see [Image at: /path], use the appropriate zai-vision MCP tool:
- zai-vision_analyze_image: general analysis
- zai-vision_extract_text_from_screenshot: text from screenshots
- zai-vision_diagnose_error_screenshot: error messages
- zai-vision_understand_technical_diagram: diagrams
- zai-vision_analyze_data_visualization: charts/graphs`,
}

interface Model {
  providerID: string
  modelID: string
}

interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
}

interface Part {
  id: string
  sessionID: string
  messageID: string
  type: string
}

interface FilePart extends Part {
  type: "file"
  mime: string
  filename?: string
  url: string
}

interface TextPart extends Part {
  type: "text"
  text: string
}

interface PluginInput {
  client: unknown
  project: unknown
  directory: string
  worktree: string
  serverUrl: URL
  $: unknown
}

interface Hooks {
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: unknown; parts: Part[] }
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: { info: Message; parts: Part[] }[] }
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] }
  ) => Promise<void>
}

type Plugin = (input: PluginInput) => Promise<Hooks>

function getConfigPath(): string {
  return join(homedir(), ".config", "opencode", "opencode-zai-vision.json")
}

function loadConfig(): VisionConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const fileContent = readFileSync(configPath, "utf-8")
    const userConfig = JSON.parse(fileContent)

    return {
      models: Array.isArray(userConfig.models)
        ? [...DEFAULT_CONFIG.models, ...userConfig.models.filter((m: string) => typeof m === "string")]
        : DEFAULT_CONFIG.models,
      imagePrefix: typeof userConfig.imagePrefix === "string"
        ? userConfig.imagePrefix
        : DEFAULT_CONFIG.imagePrefix,
      instructions: typeof userConfig.instructions === "string"
        ? userConfig.instructions
        : DEFAULT_CONFIG.instructions,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

const TEMP_DIR = join(tmpdir(), "zai-vision")
const sessionsNeedingVision = new Set<string>()
const sessionsWithImages = new Set<string>()
const tempFiles = new Map<string, string>()
let cachedConfig: VisionConfig | null = null

function getConfig(): VisionConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig()
  }
  return cachedConfig
}

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-icon": "ico",
}

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_REGEX = /^data:([^;,]+)(?:;[^,]+)?;base64,(.+)$/

function needsVisionSupport(providerID: string, modelID: string): boolean {
  const fullModelID = `${providerID}/${modelID}`
  const config = getConfig()
  return config.models.includes(fullModelID)
}

function getExtension(mime: string): string {
  const normalizedMime = mime.toLowerCase().trim()
  return MIME_TO_EXT[normalizedMime] ?? "bin"
}

function isValidBase64(str: string): boolean {
  return BASE64_REGEX.test(str)
}

function decodeDataUrl(url: string): { data: Buffer; mime: string } | null {
  if (!url || typeof url !== "string") return null
  if (!url.startsWith("data:")) return null

  const match = url.match(DATA_URL_REGEX)
  if (!match) return null

  const [, mime, base64] = match
  if (!mime || !base64) return null
  if (!isValidBase64(base64)) return null

  try {
    return {
      mime: mime.toLowerCase().trim(),
      data: Buffer.from(base64, "base64"),
    }
  } catch {
    return null
  }
}

function hashUrl(url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash).toString(16)
}

function ensureTempDir(): void {
  try {
    if (!existsSync(TEMP_DIR)) {
      mkdirSync(TEMP_DIR, { recursive: true })
    }
  } catch {}
}

function saveImageToTemp(mime: string, data: Buffer, urlHash: string): string | null {
  try {
    ensureTempDir()
    const ext = getExtension(mime)
    const filename = `zai-vision-${urlHash}.${ext}`
    const filepath = join(TEMP_DIR, filename)

    if (existsSync(filepath)) {
      return filepath
    }

    writeFileSync(filepath, data)
    tempFiles.set(urlHash, filepath)
    return filepath
  } catch {
    return null
  }
}

function cleanupFile(filepath: string): void {
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath)
    }
  } catch {}
}

function cleanup(): void {
  for (const filepath of tempFiles.values()) {
    cleanupFile(filepath)
  }
  tempFiles.clear()
}

function isFilePart(part: Part): part is FilePart {
  return part.type === "file"
}

function formatImageText(filepath: string): string {
  const config = getConfig()
  return config.imagePrefix.replace("{path}", filepath)
}

process.on("exit", cleanup)
process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})
process.on("SIGTERM", () => {
  cleanup()
  process.exit(143)
})

export const ZaiVisionPlugin: Plugin = async () => {
  return {
    "chat.message": async (input) => {
      if (input.model?.providerID && input.model?.modelID) {
        if (needsVisionSupport(input.model.providerID, input.model.modelID)) {
          sessionsNeedingVision.add(input.sessionID)
        }
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output?.messages) return

      for (const msg of output.messages) {
        if (!msg?.parts) continue

        const sessionID = msg.info?.sessionID
        if (!sessionID) continue
        if (!sessionsNeedingVision.has(sessionID)) continue

        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i]
          if (!isFilePart(part)) continue
          if (!part.mime?.toLowerCase().startsWith("image/")) continue

          const decoded = decodeDataUrl(part.url)
          if (!decoded) continue

          const urlHash = hashUrl(part.url)
          const filepath = saveImageToTemp(decoded.mime, decoded.data, urlHash)
          if (!filepath) continue

          sessionsWithImages.add(sessionID)

          const textPart: TextPart = {
            id: part.id,
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "text",
            text: formatImageText(filepath),
          }
          msg.parts[i] = textPart
        }
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      if (!sessionID) return
      if (!sessionsWithImages.has(sessionID)) return

      const config = getConfig()
      output.system.push(config.instructions)
      sessionsWithImages.delete(sessionID)
    },
  }
}

export default ZaiVisionPlugin
