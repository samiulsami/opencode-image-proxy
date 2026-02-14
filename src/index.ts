import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const sessionsWithImages = new Set<string>();
const tempFiles = new Set<string>();

const VISION_INSTRUCTIONS = `When you see [Image at: /path], use the appropriate zai-vision MCP tool:
- zai-vision_analyze_image: general analysis
- zai-vision_extract_text_from_screenshot: text from screenshots
- zai-vision_diagnose_error_screenshot: error messages
- zai-vision_understand_technical_diagram: diagrams
- zai-vision_analyze_data_visualization: charts/graphs`;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

function getExtension(mime: string): string {
  return MIME_TO_EXT[mime] || "png";
}

function decodeDataUrl(url: string): { data: Buffer; mime: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mime: match[1],
    data: Buffer.from(match[2], "base64"),
  };
}

function saveImageToTemp(mime: string, data: Buffer): string {
  const ext = getExtension(mime);
  const filename = `zai-vision-${randomUUID()}.${ext}`;
  const filepath = join(tmpdir(), filename);
  writeFileSync(filepath, data);
  tempFiles.add(filepath);
  return filepath;
}

function cleanup() {
  for (const file of tempFiles) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  tempFiles.clear();
}

process.on("exit", cleanup);

interface FilePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
}

export const ZaiVisionPlugin: Plugin = async () => {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        const parts = msg.parts as (FilePart | TextPart)[];
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (part.type !== "file") continue;
          if (!part.mime.startsWith("image/")) continue;

          const decoded = decodeDataUrl(part.url);
          if (!decoded) continue;

          const filepath = saveImageToTemp(decoded.mime, decoded.data);
          sessionsWithImages.add(part.sessionID);

          parts[i] = {
            id: part.id,
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "text",
            text: `[Image at: ${filepath}]`,
          };
        }
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) return;
      if (!sessionsWithImages.has(sessionID)) return;

      output.system.push(VISION_INSTRUCTIONS);
      sessionsWithImages.delete(sessionID);
    },
  } as Hooks;
};

export default ZaiVisionPlugin;
