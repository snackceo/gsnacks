import React, { useState } from 'react';
import { Search, MessageCircle } from 'lucide-react';
import { naturalLanguageSearch, chatWithSupport, ChatMessage } from '../services/geminiService';

interface AssistantSearchChatProps {
  products: any[];
  currentUser?: {
    _id?: string;
    id?: string;
    username?: string;
    creditBalance?: number;
    membershipTier?: string;
  } | null;
  recentOrders?: any[];
  onSearchResults: (productIds: string[], interpretation: string) => void;
}

export const AssistantSearchChat: React.FC<AssistantSearchChatProps> = ({
  products,
  currentUser,
  recentOrders = [],
  onSearchResults
}) => {
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<string>('');
  const [lastInterpretation, setLastInterpretation] = useState<string>('');

  const handleSearch = async () => {
    if (!input.trim() || isSearching) return;
    setIsSearching(true);
    setLastInterpretation('');
    try {
      const result = await naturalLanguageSearch(input, products);
      setLastInterpretation(result.interpretation);
      onSearchResults(result.matchedProducts, result.interpretation);
    } catch (err) {
      console.error('AI search failed', err);
      setLastInterpretation('Search failed — please try again.');
      onSearchResults([], '');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAsk = async () => {
    if (!input.trim() || isAsking) return;
    setIsAsking(true);
    setLastAnswer('');
    try {
      const userContext = currentUser
        ? {
            userId: currentUser._id || currentUser.id,
            username: currentUser.username,
            creditBalance: currentUser.creditBalance || 0,
            membershipTier: currentUser.membershipTier || 'COMMON',
            recentOrders: recentOrders.slice(0, 3).map(order => ({
              id: order.id,
              status: order.status,
              total: order.total,
              createdAt: order.createdAt
            }))
          }
        : {};

      const response = await chatWithSupport(input, [], userContext as any);
      setLastAnswer(response.reply);
    } catch (err) {
      console.error('Chat failed', err);
      setLastAnswer('Sorry, I encountered an error. Please try again.');
    } finally {
      setIsAsking(false);
    }
  };

  const disabled = isSearching || isAsking;

  return (
    <div className="w-full bg-ninpo-card border border-white/10 rounded-[1.75rem] p-4 shadow-xl space-y-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-ninpo-lime" />
          <p className="text-sm text-slate-300 font-semibold">Ask or search — no auto replies</p>
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Ask a question or describe what you want to find"
            className="flex-1 bg-ninpo-midnight border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-ninpo-lime/40 outline-none disabled:opacity-60"
            disabled={disabled}
          />
          <button
            onClick={handleSearch}
            disabled={!input.trim() || isSearching}
            className="px-3 py-2 bg-ninpo-lime text-ninpo-black font-bold text-xs rounded-lg uppercase tracking-wide shadow disabled:bg-slate-700"
          >
            {isSearching ? 'Searching…' : 'AI Search'}
          </button>
          <button
            onClick={handleAsk}
            disabled={!input.trim() || isAsking}
            className="px-3 py-2 bg-ninpo-black border border-white/10 text-white font-bold text-xs rounded-lg uppercase tracking-wide shadow disabled:bg-slate-700 flex items-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            {isAsking ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>

      {lastInterpretation && (
        <div className="bg-ninpo-midnight/60 border border-white/10 rounded-xl p-3 text-xs text-slate-200">
          <span className="font-semibold text-white">AI interpretation:</span> {lastInterpretation}
        </div>
      )}

      {lastAnswer && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-4 h-4 text-ninpo-lime" />
            <span className="text-xs uppercase tracking-wide text-slate-300">Answer</span>
          </div>
          <p className="text-slate-100 whitespace-pre-wrap">{lastAnswer}</p>
        </div>
      )}
    </div>
  );
};

export default AssistantSearchChat;
