# opencode-image-proxy

OpenCode plugin that proxies images through a vision-capable model, enabling image-incapable models to "see" pasted images.

## Installation

### From npm
Add this to opencode config (typically in : ~/.config/opencode/opencode.json)
```json
{
  "$schema": "https://opencode.ai/config.json",
    "plugin": [
      "@sami7786/opencode-image-proxy@latest"
    ]
}
```

## How It Works

1. Checks if the current model is in the "imageIncapableModels" list as configured
2. **If image-incapable**: Automatically sends images to a vision-capable model for analysis, then replaces the image with a text description
3. **If image-capable**: Images pass through natively with no transformation

All model calls use OpenCode's existing authentication - no separate API keys needed.

## Configuration

Create `~/.config/opencode/opencode-image-proxy.json`

<i> To see available models, run: ```opencode models``` </i>

default config:
```json
{
  "imageIncapableModels": [
    "zai-coding-plan/glm-4.5",
    "zai-coding-plan/glm-4.5-air",
    "zai-coding-plan/glm-4.5-flash",
    "zai-coding-plan/glm-4.5v",
    "zai-coding-plan/glm-4.6",
    "zai-coding-plan/glm-4.6v",
    "zai-coding-plan/glm-4.7",
    "zai-coding-plan/glm-4.7-flash",
    "zai-coding-plan/glm-5"
  ],
  "imageReaderModel": {
    "providerID": "opencode",
    "modelID": "kimi-k2.5-free"
  },
  "analysisPrompt": "The user has pasted an image into their chat. Describe what you see..."
}
```

- `imageIncapableModels` — Models that you want to enable the proxy for.
- `imageReaderModel` — Any vision-capable model in your OpenCode setup.
- `analysisPrompt` — System prompt for image analysis.

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
