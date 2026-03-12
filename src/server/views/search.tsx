function Ex({ q }: { q: string }) {
  return (
    <code
      class="block bg-gray-900 text-green-400 px-2 py-1 rounded text-xs mt-1 cursor-pointer hover:bg-gray-700 transition-colors"
      hx-get={`/search/results?q=${encodeURIComponent(q)}`}
      hx-target="#search-results"
      // @ts-ignore — inline handler string for HTMX/browser context
      onclick={`document.getElementById('search-input').value=${JSON.stringify(q)}`}
    >
      {q}
    </code>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div>
      <p class="text-gray-200 font-semibold mb-2 text-xs uppercase tracking-wider">{title}</p>
      <div class="space-y-2 text-xs text-gray-400">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <span class="text-gray-300">{label}</span>
      {children}
    </div>
  );
}

export function SearchGuide() {
  return (
    <details class="mt-3 border border-gray-700 rounded-lg overflow-hidden">
      <summary class="cursor-pointer select-none px-4 py-2 bg-gray-800 text-green-400 hover:text-green-300 font-medium text-sm flex items-center gap-2">
        <span>Search syntax &amp; examples</span>
        <span class="text-gray-600 text-xs font-normal">(click to expand)</span>
      </summary>

      <div class="bg-gray-850 border-t border-gray-700 p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">

        <Section title="Basic text search">
          <Row label="Any substring across domains, issuer, and CN:">
            <Ex q="letsencrypt" />
            <Ex q="staging" />
            <Ex q="api.mycompany.com" />
          </Row>
          <p class="text-gray-600 mt-1">Minimum 3 characters per term (trigram index).</p>
        </Section>

        <Section title="Column filters">
          <Row label="Search only in domain names:">
            <Ex q="domain:paypal.com" />
            <Ex q="domain:login" />
          </Row>
          <Row label="Search only in issuer organisation:">
            <Ex q="issuer:Let's Encrypt" />
            <Ex q="issuer:DigiCert" />
          </Row>
          <Row label="Search only in subject CN:">
            <Ex q="cn:*.internal.corp" />
            <Ex q="cn:localhost" />
          </Row>
        </Section>

        <Section title="AND — multiple terms (implicit)">
          <Row label="Space between terms = AND (all must match):">
            <Ex q="google phishing" />
            <Ex q="domain:paypal secure login" />
            <Ex q="issuer:encrypt staging api" />
          </Row>
          <p class="text-gray-600 mt-1">All terms must appear somewhere in the certificate.</p>
        </Section>

        <Section title="OR — alternatives">
          <Row label="OR (uppercase) between groups:">
            <Ex q="mycompany.com OR mycompany.io" />
            <Ex q="domain:paypal OR domain:paypai" />
            <Ex q="issuer:DigiCert OR issuer:Sectigo" />
          </Row>
          <p class="text-gray-600 mt-1">Each OR group can contain AND terms and column filters.</p>
        </Section>

        <Section title="NOT — exclusion">
          <Row label="Prefix a term with - to exclude it:">
            <Ex q="mycompany.com -staging" />
            <Ex q="domain:api -internal -test" />
            <Ex q="letsencrypt -wildcard" />
          </Row>
          <p class="text-gray-600 mt-1">At least one positive term required per group.</p>
        </Section>

        <Section title="Practical CT monitoring examples">
          <Row label="Typosquatting watch:">
            <Ex q="domain:paypa OR domain:paypall OR domain:paypa1" />
          </Row>
          <Row label="Subdomain discovery:">
            <Ex q="domain:mycompany.com -www -mail" />
          </Row>
          <Row label="Wildcard certs from a CA:">
            <Ex q="cn:* issuer:Let's Encrypt" />
          </Row>
          <Row label="Phishing prep detection:">
            <Ex q="domain:google -google.com OR domain:facebook -facebook.com" />
          </Row>
        </Section>

      </div>
    </details>
  );
}
