# ZAI Vision Plugin Plan

## Goal
Allow pasting images directly into opencode when using ZAI models. Auto-save to temp file and instruct LLM to use vision MCP tool.

## Problem
- ZAI models can't process images directly - they need MCP tools
- Current UX: copy image → save to file → manually point opencode to it
- Desired UX: paste image → auto-convert to ZAI-compatible format

## Solution: Plugin with message transform

### Plugin Hook: `experimental.chat.messages.transform`

1. Detect when current model is ZAI (`model.providerID.includes('zai')`)
2. Scan messages for `FilePart` with image mime types
3. For each image:
   - Decode base64 data
   - Save to temp file (e.g., `/tmp/zai-vision-<uuid>.png`)
   - Replace `FilePart` with text: `Image saved to: /tmp/zai-vision-xxx.png\n\nUse the appropriate vision tool (zai-vision_analyze_image, zai-vision_extract_text_from_screenshot, etc.) to analyze this image.`
4. Append to system prompt: instructions on which vision tool to use based on context

### Plugin Hook: `experimental.chat.system.transform`

Add system instructions when ZAI model detected:
```
When the user provides an image, you MUST use the zai-vision MCP tools to analyze it:
- zai-vision_analyze_image: general image analysis
- zai-vision_extract_text_from_screenshot: extract text from screenshots
- zai-vision_diagnose_error_screenshot: analyze error messages
- zai-vision_understand_technical_diagram: analyze diagrams
- zai-vision_analyze_data_visualization: analyze charts/graphs
```

## File Structure
```
opencode-zai-vision/
├── package.json
├── src/
│   └── index.ts
├── tsconfig.json
└── README.md
```

## Key Files to Reference

1. **Plugin types/hooks**: `packages/opencode/src/plugin/index.ts` or `@opencode-ai/plugin`
2. **Existing plugin example**: `packages/opencode/src/plugin/copilot.ts` - shows vision handling pattern
3. **Image paste handling**: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` - `pasteImage()` function
4. **Message types**: Look for `FilePart`, `TextPart`, `Message` types in opencode packages

## Implementation Steps

1. Create npm package `@sami/opencode-zai-vision`
2. Implement `experimental.chat.messages.transform` hook
3. Implement `experimental.chat.system.transform` hook
4. Handle temp file creation with `fs` and `os.tmpdir()`
5. Add cleanup mechanism (delete temp files after session/message processed)
6. Test with ZAI model
7. Publish to npm

## Config

User adds to `opencode.json`:
```json
{
  "plugin": [
    "@sahaj-b/opencode-notifier@latest",
    "@sami/opencode-zai-vision@latest"
  ]
}
```

## Notes

- Use `node:fs` and `node:crypto.randomUUID()` for temp files
- No external dependencies needed
- Cross-platform: `os.tmpdir()` works on Windows/Mac/Linux
- Cleanup: Could use `process.on('exit')` or track files per-session
