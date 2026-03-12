import { Layout } from "./layout.tsx";
import { SearchForm } from "./components/search-form.tsx";

export function SearchPage({ query }: { query?: string }) {
  return (
    <Layout title="Search">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-green-400 mb-4">Search Certificates</h1>
        <SearchForm query={query} />
      </div>
      <div id="search-results"></div>
    </Layout>
  );
}
