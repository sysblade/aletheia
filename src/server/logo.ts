import logoFile from "../static/logo.png" with { type: "file" };

// In dev mode: logoFile is the real file path.
// In compiled mode: Bun embeds the file and logoFile is a $bunfs/ path.
export { logoFile };
