import { Layout } from "./layout.tsx";
import { SearchForm } from "./components/search-form.tsx";
import { SearchGuide } from "./search.tsx";
import { StatsCard } from "./components/stats-card.tsx";
import { LiveStreamSection } from "./components/live-stream.tsx";
import type { Stats } from "../../types/certificate.ts";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function HomePage({
  stats,
  insertRate,
  uptimeSeconds,
  filterMode,
  query,
}: {
  stats: Stats;
  insertRate: number;
  uptimeSeconds: number;
  filterMode: string;
  query?: string;
}) {
  return (
    <Layout>
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-green-400 mb-2">Certificate Transparency Log</h1>
        <p class="text-gray-400">Real-time monitoring of publicly-issued TLS certificates</p>
      </div>

      <div class="mb-8">
        <SearchForm query={query} />
        <SearchGuide />
      </div>

      <script dangerouslySetInnerHTML={{
          __html: `(function(){
  console.log('[Aletheia] Search cancellation script loaded');
  var es=null;
  var cancelBtn=null;
  var cancelled=false;
  function fmtBytes(b){
    if(b<1e6)return(b/1e3).toFixed(1)+' KB';
    if(b<1e9)return(b/1e6).toFixed(1)+' MB';
    return(b/1e9).toFixed(2)+' GB';
  }
  function hideSpinner(){
    var spinner=document.getElementById('search-spinner');
    if(spinner)spinner.classList.remove('htmx-request');
  }
  function cancelSearch(){
    cancelled=true;
    if(es){
      es.close();
      es=null;
    }
    if(cancelBtn){
      cancelBtn.remove();
      cancelBtn=null;
    }
    hideSpinner();
  }
  function startSearch(q,page){
    console.log('[Aletheia] Starting SSE search for:', q);
    cancelSearch();
    cancelled=false;
    var rd=document.getElementById('search-results');

    // Hide HTMX spinner (we have our own progress UI)
    hideSpinner();

    // Create cancel button
    cancelBtn=document.createElement('div');
    cancelBtn.className='text-center mb-3';
    cancelBtn.innerHTML='<button class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">Cancel Search</button>';
    cancelBtn.querySelector('button').onclick=function(){
      cancelSearch();
      rd.innerHTML='<div class="text-center py-12 text-yellow-400">Search cancelled</div>';
    };

    rd.innerHTML='<div class="text-center py-8 text-gray-400"><div class="text-sm mb-3">Searching...</div><div class="w-full max-w-sm mx-auto bg-gray-800 rounded-full h-1 mb-3 overflow-hidden"><div id="spb" class="bg-green-500 h-1 rounded-full transition-all duration-300" style="width:0%"></div></div><div id="sps" class="text-xs text-gray-500 flex justify-center gap-4"><span>\u2014</span></div></div>';
    rd.insertBefore(cancelBtn, rd.firstChild);

    var url='/search/stream?q='+encodeURIComponent(q)+'&page='+page;
    console.log('[Aletheia] Opening EventSource:', url);
    es=new EventSource(url);
    es.addEventListener('progress',function(e){
      if(cancelled)return;
      var p=JSON.parse(e.data);
      var pct=p.totalRows?Math.round(p.readRows/p.totalRows*100):0;
      var bar=document.getElementById('spb');
      var stats=document.getElementById('sps');
      if(bar){
        bar.style.width=p.totalRows?pct+'%':'100%';
        if(!p.totalRows)bar.classList.add('animate-pulse');
      }
      if(stats)stats.innerHTML='<span>'+p.readRows.toLocaleString()+(p.totalRows?' / '+p.totalRows.toLocaleString():'')+' rows</span><span>'+fmtBytes(p.readBytes)+'</span><span>'+p.elapsedMs+'ms</span>';
    });
    es.addEventListener('result',function(e){
      if(cancelled)return;
      var rd=document.getElementById('search-results');
      rd.innerHTML=e.data;
      if(window.htmx)htmx.process(rd);
      cancelSearch();
      var pushUrl=page===1?'/?q='+encodeURIComponent(q):'/?q='+encodeURIComponent(q)+'&page='+page;
      history.pushState({},'',pushUrl);
    });
    es.addEventListener('cancelled',function(e){
      if(cancelled)return;
      cancelled=true;
      var rd=document.getElementById('search-results');
      rd.innerHTML='<div class="text-center py-12 text-yellow-400">'+e.data+'</div>';
      cancelSearch();
    });
    es.addEventListener('error-msg',function(e){
      if(cancelled)return;
      var rd=document.getElementById('search-results');
      rd.innerHTML='<div class="text-center py-12 text-red-400">'+e.data+'</div>';
      cancelSearch();
    });
    es.onerror=function(){
      if(!cancelled)cancelSearch();
    };
  }
  var form=document.getElementById('search-form');
  if(form){
    console.log('[Aletheia] Attaching submit handler to search form');
    form.addEventListener('submit',function(e){
      console.log('[Aletheia] Form submitted, preventing default and using SSE');
      e.preventDefault();
      e.stopPropagation();
      var q=document.getElementById('search-input').value.trim();
      if(q.length<2)return;
      startSearch(q,1);
      return false;
    });
  } else {
    console.error('[Aletheia] Search form not found!');
  }
  document.addEventListener('DOMContentLoaded',function(){
    var inp=document.getElementById('search-input');
    if(inp&&inp.value.trim().length>=2){
      var sp=new URLSearchParams(window.location.search);
      var pg=Math.max(1,parseInt(sp.get('page')||'1',10));
      startSearch(inp.value.trim(),pg);
    }
  });
})();`,
        }}
      />

      <div id="search-results"></div>

      <div
        class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8"
        hx-get="/partials/stats"
        hx-trigger="every 5s"
        hx-swap="innerHTML"
      >
        <StatsCards stats={stats} insertRate={insertRate} uptimeSeconds={uptimeSeconds} filterMode={filterMode} />
      </div>

      <LiveStreamSection />
    </Layout>
  );
}

export function StatsCards({
  stats,
  insertRate,
  uptimeSeconds,
  filterMode,
}: {
  stats: Stats;
  insertRate: number;
  uptimeSeconds: number;
  filterMode: string;
}) {
  return (
    <>
      <StatsCard label="Total Certificates" value={stats.totalCertificates} />
      <StatsCard label="Unique Issuers" value={stats.uniqueIssuers} />
      <StatsCard label="Insert Rate" value={`${insertRate}/s`} sub={filterMode} />
      <StatsCard label="Uptime" value={formatUptime(uptimeSeconds)} />
    </>
  );
}
