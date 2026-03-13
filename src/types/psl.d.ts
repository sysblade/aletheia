/**
 * Type declarations for psl package.
 * The psl package provides its own types, but they're not properly exported
 * in a way that works with both TypeScript and Bun bundler.
 */
declare module "psl" {
  export interface ParsedDomain {
    input: string;
    tld: string | null;
    sld: string | null;
    domain: string | null;
    subdomain: string | null;
    listed: boolean;
  }

  export interface ErrorResult {
    input: string;
    error: {
      code: string;
      message: string;
    };
  }

  export function parse(domain: string): ParsedDomain | ErrorResult;
  export function get(domain: string): string | null;
  export function isValid(domain: string): boolean;
}
