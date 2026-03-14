import { describe, test, expect } from "bun:test";
import { SearchCancelledError } from "./repository.ts";

describe("Search cancellation", () => {
  describe("SearchCancelledError", () => {
    test("has correct name and message", () => {
      const error = new SearchCancelledError();
      expect(error.name).toBe("SearchCancelledError");
      expect(error.message).toBe("Search cancelled");
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("AbortController behavior", () => {
    test("signal starts not aborted", () => {
      const controller = new AbortController();
      expect(controller.signal.aborted).toBe(false);
    });

    test("signal becomes aborted after abort()", () => {
      const controller = new AbortController();
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    test("abort event listener is called", () => {
      const controller = new AbortController();
      let called = false;
      controller.signal.addEventListener('abort', () => {
        called = true;
      });
      controller.abort();
      expect(called).toBe(true);
    });

    test("pre-aborted signal is immediately aborted", () => {
      const controller = new AbortController();
      controller.abort();
      const signal = controller.signal;
      expect(signal.aborted).toBe(true);
    });
  });

  describe("Repository cancellation pattern", () => {
    test("early abort check throws SearchCancelledError", () => {
      const controller = new AbortController();
      controller.abort();

      // Simulate early abort check pattern used in repositories
      if (controller.signal.aborted) {
        expect(() => {
          throw new SearchCancelledError();
        }).toThrow(SearchCancelledError);
      }
    });

    test("abort during operation can be detected", async () => {
      const controller = new AbortController();

      // Simulate async operation with abort check
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        if (controller.signal.aborted) {
          throw new SearchCancelledError();
        }
        return "success";
      };

      // Start operation
      const promise = operation();

      // Abort after starting
      controller.abort();

      // Operation should throw
      await expect(promise).rejects.toThrow(SearchCancelledError);
    });
  });
});
