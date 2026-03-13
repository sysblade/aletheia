// Bun embeds the PNG bytes at compile time via the "base64" loader configured
// in bunfig.toml — the equivalent of Go's //go:embed.
import logoBase64 from "../../static/logo.png";

export const logo = Buffer.from(logoBase64 as unknown as string, "base64");
