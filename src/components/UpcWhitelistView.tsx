import React, { useState, useEffect, useCallback } from 'react';
import { getWhitelist, addUpcToWhitelist, removeUpcFromWhitelist, UpcItem } from '../upcService';
import { Loader2, AlertTriangle, Plus, X } from 'lucide-react';

export const UpcWhitelistView: React.FC = () => {
  const [upcs, setUpcs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUpc, setNewUpc] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const fetchWhitelist = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getWhitelist();
      if (response.ok) {
        setUpcs(response.upcs);
      } else {
        throw new Error('Failed to fetch UPC whitelist from server.');
      }
    } catch (err: any) {
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWhitelist();
  }, [fetchWhitelist]);

  const handleAddUpc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpc.trim() || isAdding) return;

    const upcToAdd = newUpc.trim();

    setIsAdding(true);
    setError(null);

    // Optimistically add to the UI
    setUpcs(prev => [upcToAdd, ...prev]);
    setNewUpc('');

    try {
      const response = await addUpcToWhitelist(upcToAdd);
      if (!response.ok) {
        throw new Error('Failed to add UPC to whitelist.');
      }
    } catch (err: any) {
      setError(err.message || 'An unknown error occurred while adding the UPC.');
      // On failure, revert the optimistic update by removing the item
      setUpcs(prev => prev.filter(upc => upc !== upcToAdd));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveUpc = async (upcToRemove: string) => {
    // Optimistically remove from UI
    setUpcs((prev: string[]) => prev.filter((upc: string) => upc !== upcToRemove));

    try {
      const response = await removeUpcFromWhitelist(upcToRemove);
      if (!response.ok) {
        throw new Error('Server failed to remove UPC.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to remove UPC. Refreshing list.');
      // Re-fetch to get the correct state on failure
      await fetchWhitelist();
    }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /><span>Loading UPC Whitelist...</span></div>;
  }

  if (error) {
    return <div className="flex items-center gap-2 text-red-400"><AlertTriangle className="w-4 h-4" /><span>Error: {error}</span></div>;
  }

  return (
    <div className="p-4 bg-ninpo-black/50 rounded-lg">
      <h2 className="text-lg font-bold text-white mb-3">Eligible UPC Whitelist ({upcs.length})</h2>
      <form onSubmit={handleAddUpc} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newUpc}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUpc(e.target.value)}
          placeholder="Enter new UPC to add"
          className="flex-grow bg-black/40 border border-white/10 rounded-md p-2 text-sm text-white placeholder:text-slate-500"
          disabled={isAdding}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-ninpo-lime text-ninpo-black font-bold flex items-center gap-2 disabled:opacity-50"
          disabled={!newUpc.trim() || isAdding}
        >
          {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </button>
      </form>
      <div className="max-h-96 overflow-y-auto bg-black/30 p-3 rounded-md space-y-1">
        {upcs.map((upc: string) => (
          <div key={upc} className="flex items-center justify-between p-1 rounded hover:bg-white/5">
            <span className="font-mono text-sm text-slate-300">{upc}</span>
            <button onClick={() => handleRemoveUpc(upc)} className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {upcs.length === 0 && <p className="text-slate-500">No eligible UPCs found.</p>}
      </div>
    </div>
  );
};

export default UpcWhitelistView;
