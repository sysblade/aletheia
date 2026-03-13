declare module "*.png" {
  const path: string;
  export default path;
}

/** Injected at compile time via --define. Falls back to "dev" in dev/test. */
declare const GIT_COMMIT: string;
