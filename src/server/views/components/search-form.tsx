export function SearchForm({ query }: { query?: string }) {
  return (
    <form
      hx-get="/search/results"
      hx-target="#search-results"
      hx-trigger="submit"
      hx-indicator="#search-spinner"
      class="w-full"
    >
      <div class="flex gap-3">
        <div class="relative flex-1">
          <input
            type="text"
            name="q"
            id="search-input"
            value={query || ""}
            placeholder="Search domains, issuers... (e.g. *.google.com, Let's Encrypt)"
            class="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            autocomplete="off"
            minlength={2}
          />
          <div id="search-spinner" class="htmx-indicator absolute right-3 top-3.5">
            <svg class="animate-spin h-5 w-5 text-green-400" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </div>
        <button
          type="submit"
          class="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Search
        </button>
      </div>
    </form>
  );
}
