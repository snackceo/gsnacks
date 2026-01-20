import React, { useState } from 'react';
import { Search, MessageCircle, Star } from 'lucide-react';
import { BACKEND_URL } from '../constants';

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
  onOpenReturnScanner?: () => void;
  onOpenRecommendations?: () => void;
}

export const AssistantSearchChat: React.FC<AssistantSearchChatProps> = ({
  products,
  currentUser,
  recentOrders = [],
  onSearchResults,
  onOpenReturnScanner,
  onOpenRecommendations
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastReply, setLastReply] = useState<string>('');
  const [lastInterpretation, setLastInterpretation] = useState<string>('');
  const [recommendations, setRecommendations] = useState<any[]>([]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;
    setIsLoading(true);
    setLastReply('');
    setLastInterpretation('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: input,
          products: products.map(p => ({ _id: p._id || p.id, name: p.name, category: p.category, description: p.description })),
          context: {
            userId: currentUser?._id || currentUser?.id,
            username: currentUser?.username,
            creditBalance: currentUser?.creditBalance || 0,
            membershipTier: currentUser?.membershipTier || 'COMMON'
          }
        })
      });

      if (!response.ok) {
        setLastReply('Error: unable to process request');
        setIsLoading(false);
        return;
      }

      const data = await response.json();

      // Route based on response type
      if (data.type === 'products') {
        // Product search result
        setLastInterpretation(data.interpretation || '');
        onSearchResults(data.productIds || [], data.interpretation || '');
      } else if (data.type === 'action') {
        // Action result
        if (data.action === 'open_return_scanner' && onOpenReturnScanner) {
          onOpenReturnScanner();
          setLastReply(data.message || 'Opening return scanner...');
        } else if (data.action === 'open_recommendations' && onOpenRecommendations) {
          onOpenRecommendations();
          // Fetch recommendations
          fetchRecommendations();
          setLastReply(data.message || 'Fetching personalized recommendations...');
        } else {
          setLastReply(data.message || 'Action processed');
        }
      } else if (data.type === 'chat') {
        // Chat reply
        setLastReply(data.reply || '');
      } else {
        setLastReply('Unexpected response type');
      }

      setInput('');
    } catch (err) {
      console.error('Assistant error:', err);
      setLastReply('Sorry, I encountered an error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const disabled = isLoading;

  const fetchRecommendations = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: currentUser?._id || currentUser?.id,
          orderHistory: recentOrders.slice(0, 10),
          currentCart: []
        })
      });

      if (response.ok) {
        const data = await response.json();
        setRecommendations(data.recommendations || []);
      }
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    }
  };

  return (
    <div className="w-full bg-ninpo-card border border-white/10 rounded-[1.75rem] p-4 shadow-xl space-y-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-ninpo-lime" />
          <p className="text-sm text-slate-300 font-semibold">Search, ask, or scan — all in one</p>
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Search products or ask a question..."
            className="flex-1 bg-ninpo-midnight border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-ninpo-lime/40 outline-none disabled:opacity-60"
            disabled={disabled}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="px-3 py-2 bg-ninpo-lime text-ninpo-black font-bold text-xs rounded-lg uppercase tracking-wide shadow disabled:bg-slate-700 flex items-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            {isLoading ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>

      {lastInterpretation && (
        <div className="bg-ninpo-midnight/60 border border-white/10 rounded-xl p-3 text-xs text-slate-200">
          <span className="font-semibold text-white">Found:</span> {lastInterpretation}
        </div>
      )}

      {lastReply && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-4 h-4 text-ninpo-lime" />
            <span className="text-xs uppercase tracking-wide text-slate-300">Response</span>
          </div>
          <p className="text-slate-100 whitespace-pre-wrap">{lastReply}</p>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="bg-ninpo-midnight/60 border border-white/10 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-ninpo-lime" />
            <span className="text-xs uppercase tracking-wide text-slate-300 font-semibold">Recommended for you</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {recommendations.map(product => (
              <div key={product._id || product.id} className="bg-white/5 border border-white/10 rounded-lg p-2 cursor-pointer hover:border-ninpo-lime/40 transition-colors">
                <p className="text-xs font-semibold text-white line-clamp-2">{product.name}</p>
                <p className="text-xs text-slate-400 mt-1">${product.price?.toFixed(2) || '0.00'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AssistantSearchChat;
