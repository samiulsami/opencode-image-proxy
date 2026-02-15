# @sami/opencode-zai-vision

OpenCode plugin that allows you to directly paste images, and have z.ai models automatically parse them using the z.ai vision mcp.

## Installation

### From npm
```json
{
  "plugin": ["@sami/opencode-zai-vision@latest"]
}
```

### Local Development
```json
{
  "plugin": ["file:///path/to/opencode-zai-vision/dist/index.js"]
}
```

## How It Works

1. Detects when a configured model is in use
2. On image paste, decodes base64 data and saves to `/tmp/zai-vision/`
3. Replaces image with configurable text reference
4. Appends vision MCP instructions to system prompt
5. Cleans up temp files on process exit

## Configuration

Create `~/.config/opencode/opencode-zai-vision.json` (optional):

```json
{
  "models": [
    "zai-coding-plan/custom-model"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `models` | `string[]` | Additional models to enable vision for (added to defaults) |
| `imagePrefix` | `string` | Text template replacing images; `{path}` → temp file path |
| `instructions` | `string` | System prompt appended when images are present |

### Defaults

If not configured, these defaults are used:

```json
{
  "imagePrefix": "[Image at: {path}]",
  "instructions": "When you see [Image at: /path], use the appropriate zai-vision MCP tool:\n- zai-vision_analyze_image: general analysis\n- zai-vision_extract_text_from_screenshot: text from screenshots\n- zai-vision_diagnose_error_screenshot: error messages\n- zai-vision_understand_technical_diagram: diagrams\n- zai-vision_analyze_data_visualization: charts/graphs"
}
```

**Note:** User-provided `imagePrefix` and `instructions` **replace** the defaults entirely, they are not merged. Only `models` are additive.

### Default Models

The plugin activates for these models by default:

```
zai-coding-plan/glm-4.5
zai-coding-plan/glm-4.5-air
zai-coding-plan/glm-4.5-flash
zai-coding-plan/glm-4.5v
zai-coding-plan/glm-4.6
zai-coding-plan/glm-4.6v
zai-coding-plan/glm-4.7
zai-coding-plan/glm-4.7-flash
zai-coding-plan/glm-5
```

User-configured models are **added** to this list, not replaced.

### Required MCP Tools

Ensure `zai-vision` MCP server is configured in your `opencode.json`:

```json
{
  "mcp": {
    "zai-vision": {
      "type": "local",
      "command": ["sh", "-c", "Z_AI_API_KEY=your-key npx -y @z_ai/mcp-server"]
    }
  }
}
```

## Vision Tools Reference

| Tool | Use Case |
|------|----------|
| `zai-vision_analyze_image` | General image analysis |
| `zai-vision_extract_text_from_screenshot` | OCR / text extraction |
| `zai-vision_diagnose_error_screenshot` | Error message analysis |
| `zai-vision_understand_technical_diagram` | Architecture/flowcharts |
| `zai-vision_analyze_data_visualization` | Charts/graphs/dashboards |

## Limitations

- Only processes images with `data:` URL scheme (pasted images)
- Does not handle images from file paths or remote URLs
- Temp files persist until process exit
- Maximum image size depends on MCP server limits

## Building

```bash
npm install
npm run build
```

## License

MIT
