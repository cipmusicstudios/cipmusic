import React, { useState, useMemo } from 'react';
import { LOCAL_IMPORT_OFFICIAL_METADATA } from './local-import-official-metadata.generated';
import { ARTIST_DICTIONARY } from './local-import-artist-normalization';

export default function AuditGallery() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'artist' | 'category' | 'all'>('all');

  const tracks = useMemo(() => {
    return Object.entries(LOCAL_IMPORT_OFFICIAL_METADATA as any).map(([slug, data]: [string, any]) => ({
      slug,
      ...data
    })).filter(t => {
      const s = search.toLowerCase();
      return t.slug.toLowerCase().includes(s) || 
             t.artist.toLowerCase().includes(s) || 
             t.mappedCategory.toLowerCase().includes(s);
    });
  }, [search]);

  const artists = useMemo(() => {
    const map = new Map<string, any>();
    Object.values(LOCAL_IMPORT_OFFICIAL_METADATA as any).forEach((track: any) => {
      track.normalizedArtistsInfo.forEach((info: any) => {
        if (!map.has(info.id)) {
          map.set(info.id, {
            ...info,
            count: 1
          });
        } else {
          map.get(info.id).count++;
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
      <header className="mb-12">
        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-4">Library Metadata Auditor</h1>
        <p className="text-slate-500 mb-8 max-w-2xl">High-performance diagnostic view for verified artist aggregation and category classification results.</p>
        
        <div className="flex flex-col md:flex-row gap-4 items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div className="relative flex-1 w-full">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input 
              type="text" 
              placeholder="Search by artist, title, or category..." 
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-100 border-none outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {(['all', 'artist', 'category'] as const).map(v => (
              <button 
                key={v}
                onClick={() => setView(v)}
                className={`px-6 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${view === v ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === 'all' && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Cover</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Title (Slug)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Artist (Normalized)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Category</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tracks.map(track => (
                <tr key={track.slug} className="hover:bg-blue-50/30 transition-colors group">
                  <td className="px-6 py-4">
                    <img src={track.cover || 'https://i.imgur.com/o9yXFgS.png'} className="w-12 h-12 rounded-lg object-cover shadow-sm bg-slate-200" alt="" referrerPolicy="no-referrer" />
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-900">{track.slug}</div>
                    <div className="text-xs text-slate-400 font-mono uppercase tracking-tighter">ID: {track.normalizedArtistsInfo[0]?.id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {track.normalizedArtistsInfo.map(info => (
                        <span key={info.id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                          {info.names.zhHans || info.names.en}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                      track.mappedCategory === '华语流行' ? 'bg-red-50 text-red-600 border-red-100' :
                      track.mappedCategory === '韩流流行' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                      track.mappedCategory === '欧美流行' ? 'bg-sky-50 text-sky-600 border-sky-100' :
                      track.mappedCategory === '日系流行' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                      'bg-slate-100 text-slate-400 border-slate-200'
                    }`}>
                      {track.mappedCategory}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${track.officialStatus === 'confirmed' ? 'text-emerald-500' : 'text-amber-500/60'}`}>
                      {track.officialStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'artist' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {artists.map(artist => (
            <div key={artist.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center text-2xl font-black text-slate-300 mb-4 border border-slate-200 overflow-hidden shadow-inner">
                {artist.names.en?.[0] || artist.names.zhHans?.[0]}
              </div>
              <h3 className="font-bold text-lg text-slate-900">{artist.names.zhHans || artist.names.en}</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">{artist.names.en}</p>
              <div className="mt-auto flex items-center gap-2">
                <span className="text-blue-600 font-black text-2xl">{artist.count}</span>
                <span className="text-slate-400 uppercase text-[10px] font-black tracking-widest">Songs</span>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 w-full flex justify-center gap-2">
                 <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-widest">{artist.nationality}</span>
                 <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-widest">{artist.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'category' && (
        <div className="grid grid-cols-1 gap-12">
          {['华语流行', '韩流流行', '欧美流行', '日系流行', 'Uncategorized'].map(cat => {
            const catTracks = tracks.filter(t => t.mappedCategory === cat);
            if (catTracks.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
                  <span className="w-2 h-8 bg-blue-600 rounded-full"></span>
                  {cat}
                  <span className="text-slate-300 text-sm font-medium">({catTracks.length} items)</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {catTracks.map(track => (
                    <div key={track.slug} className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 group">
                      <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-inner">
                        <img src={track.cover || 'https://i.imgur.com/o9yXFgS.png'} className="w-full h-full object-cover transition-transform group-hover:scale-110" alt="" referrerPolicy="no-referrer" />
                      </div>
                      <div className="text-[10px] font-bold text-slate-900 truncate">{track.slug}</div>
                      <div className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter truncate">{track.artist}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
