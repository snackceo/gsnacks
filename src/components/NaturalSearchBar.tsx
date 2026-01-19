// src/components/NaturalSearchBar.tsx
import React, { useState } from 'react';
import { naturalLanguageSearch, NaturalSearchResult } from '../services/geminiService';
import { Search, Sparkles, X } from 'lucide-react';

interface NaturalSearchBarProps {
  products: any[];
  onSearchResults: (productIds: string[], interpretation: string) => void;
  placeholder?: string;
}

export const NaturalSearchBar: React.FC<NaturalSearchBarProps> = ({
  products,
  onSearchResults,
  placeholder = "Try: 'cheap snacks under $5' or 'healthy breakfast options'"
}) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [lastInterpretation, setLastInterpretation] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim() || isSearching) return;

    setIsSearching(true);
    setLastInterpretation(null);

    try {
      const result: NaturalSearchResult = await naturalLanguageSearch(query, products);
      
      setLastInterpretation(result.interpretation);
      onSearchResults(result.matchedProducts, result.interpretation);
    } catch (error) {
      console.error('Natural search error:', error);
      setLastInterpretation('Search failed - please try again');
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setQuery('');
    setLastInterpretation(null);
    onSearchResults([], '');
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-ninpo-lime" />
          <Search className="w-4 h-4 text-slate-500" />
        </div>
        
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={isSearching}
          className="w-full bg-ninpo-midnight border border-white/10 text-white pl-16 pr-24 py-5 rounded-[2rem] text-sm outline-none placeholder:text-slate-700 focus:border-ninpo-lime/30 transition-all disabled:opacity-60"
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {query && (
            <button
              onClick={clearSearch}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          )}
          
          <button
            onClick={handleSearch}
            disabled={!query.trim() || isSearching}
            className="px-4 py-2 bg-ninpo-lime hover:bg-ninpo-lime/90 disabled:bg-slate-700 text-ninpo-black font-bold text-xs uppercase tracking-wide rounded-xl transition-all flex items-center gap-2"
          >
            {isSearching ? (
              <>
                <div className="w-3 h-3 border-2 border-ninpo-black/20 border-t-ninpo-black rounded-full animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                AI Search
              </>
            )}
          </button>
        </div>
      </div>

      {lastInterpretation && (
        <div className="bg-ninpo-midnight/60 border border-white/5 rounded-xl p-3 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-ninpo-lime flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-bold text-white mb-1">AI Interpretation:</p>
            <p className="text-xs text-slate-400">{lastInterpretation}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {['cheap snacks under $5', 'healthy breakfast', 'gluten free', 'party drinks', 'best sellers'].map((example) => (
          <button
            key={example}
            onClick={() => {
              setQuery(example);
              setTimeout(handleSearch, 100);
            }}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-xs text-slate-400 hover:text-white transition-colors"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
};
