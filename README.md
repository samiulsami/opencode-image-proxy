# @sami/opencode-zai-vision

OpenCode plugin that enables image pasting for ZAI models by converting images to temp files and instructing the LLM to use vision MCP tools.

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["@sami/opencode-zai-vision@latest"]
}
```

## How It Works

1. When you paste an image, it's stored as a base64 data URL
2. Before sending to ZAI, this plugin:
   - Decodes the image and saves it to a temp file
   - Replaces the image with a text reference: `[Image at: /tmp/zai-vision-xxx.png]`
3. Adds system instructions telling the LLM which vision MCP tool to use
4. Temp files are cleaned up when the process exits

## Available Vision Tools

The plugin instructs the LLM about these tools:

- `zai-vision_analyze_image` - general image analysis
- `zai-vision_extract_text_from_screenshot` - extract text from screenshots
- `zai-vision_diagnose_error_screenshot` - analyze error messages
- `zai-vision_understand_technical_diagram` - analyze diagrams
- `zai-vision_analyze_data_visualization` - analyze charts/graphs

## Requirements

- ZAI provider configured in opencode
- zai-vision MCP tools available
