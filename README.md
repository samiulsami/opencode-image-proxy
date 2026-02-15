# @sami/opencode-image-proxy

OpenCode plugin that proxies images through a vision-capable model, enabling image-incapable models to "see" pasted images.

## Installation

### From npm
```json
{
  "plugin": ["@sami/opencode-image-proxy@latest"]
}
```

### Local Development
```json
{
  "plugin": ["file:///path/to/opencode-image-proxy/dist/index.js"]
}
```

## How It Works

1. Detects if the current model is image-incapable (from the configured list)
2. **If image-incapable**: Automatically sends images to a vision-capable model for analysis, then replaces the image with a text description
3. **If image-capable**: Images pass through natively with no transformation

All model calls use OpenCode's existing authentication - no separate API keys needed.

## Configuration

Create `$XDG_CONFIG_HOME/opencode/opencode-image-proxy.json` (or `~/.config/opencode/opencode-image-proxy.json` if XDG_CONFIG_HOME is not set):

```json
{
  "imageIncapableModels": ["some-provider/some-model"],
  "imageReaderModel": {
    "providerID": "github-copilot",
    "modelID": "gpt-5-mini"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `imageIncapableModels` | `string[]` | (see below) | Models that can't process images (replaces defaults if set) |
| `imageReaderModel` | `{ providerID, modelID }` | `{ providerID: "github-copilot", modelID: "gpt-5-mini" }` | Vision model to proxy images through |
| `analysisPrompt` | `string` | (see source) | System prompt for image analysis |

### Default Image-Incapable Models

These models are detected as image-incapable by default:

```json
[
  "zai-coding-plan/glm-4.5",
  "zai-coding-plan/glm-4.5-air",
  "zai-coding-plan/glm-4.5-flash",
  "zai-coding-plan/glm-4.5v",
  "zai-coding-plan/glm-4.6",
  "zai-coding-plan/glm-4.6v",
  "zai-coding-plan/glm-4.7",
  "zai-coding-plan/glm-4.7-flash",
  "zai-coding-plan/glm-5"
]
```

**Note:** Setting `imageIncapableModels` in config replaces these defaults entirely.

### Default Image Reader Model

Uses `github-copilot/gpt-5-mini` by default. Configure any vision-capable model:

```json
{
  "imageReaderModel": {
    "providerID": "anthropic",
    "modelID": "claude-sonnet-4-20250514"
  }
}
```

### Behavior

| Model | Result |
|-------|--------|
| In image-incapable list | Images proxied through vision model, replaced with descriptions |
| NOT in list | Images pass through natively |

## Example Output

```
[User pasted image: screenshot.png]
This is a terminal window showing a Node.js error. The error message reads:
"TypeError: Cannot read property 'map' of undefined" at line 42 in app.js.
The stack trace below shows the error originated in the UserList component...
```

## Requirements

- The configured `imageReaderModel` must be available and authenticated in OpenCode
- The vision model must support image input

## Building

```bash
npm install
npm run build
```

## License

MIT
