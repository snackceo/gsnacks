// src/components/ProductRecommendations.tsx
import React, { useState, useEffect } from 'react';
import { getProductRecommendations, ProductRecommendation } from '../services/geminiService';
import { Sparkles, TrendingUp } from 'lucide-react';

interface ProductRecommendationsProps {
  userId: string;
  orderHistory?: any[];
  currentCart?: any[];
  onProductClick?: (productName: string) => void;
}

export const ProductRecommendations: React.FC<ProductRecommendationsProps> = ({
  userId,
  orderHistory = [],
  currentCart = [],
  onProductClick
}) => {
  const [recommendations, setRecommendations] = useState<ProductRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecommendations();
  }, [userId]);

  const loadRecommendations = async () => {
    if (!userId) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const result = await getProductRecommendations(userId, orderHistory, currentCart);
      setRecommendations(result.recommendations.slice(0, 5)); // Top 5
    } catch (err) {
      setError('Unable to load recommendations');
      console.error('Recommendations error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!userId) return null;
  if (isLoading) {
    return (
      <div className="bg-ninpo-card border border-white/10 rounded-[2.5rem] p-8">
        <div className="flex items-center gap-3 mb-6">
          <Sparkles className="w-5 h-5 text-ninpo-lime animate-pulse" />
          <h3 className="text-white font-black uppercase text-[11px] tracking-widest">
            AI Recommendations
          </h3>
        </div>
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ninpo-lime"></div>
        </div>
      </div>
    );
  }

  if (error || recommendations.length === 0) return null;

  return (
    <div className="bg-ninpo-card border border-white/10 rounded-[2.5rem] p-8">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-5 h-5 text-ninpo-lime" />
        <h3 className="text-white font-black uppercase text-[11px] tracking-widest">
          Recommended For You
        </h3>
        <button
          onClick={loadRecommendations}
          className="ml-auto text-xs text-slate-500 hover:text-ninpo-lime transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {recommendations.map((rec, idx) => (
          <div
            key={idx}
            onClick={() => onProductClick?.(rec.productName)}
            className="bg-ninpo-midnight/50 border border-white/5 rounded-2xl p-4 hover:border-ninpo-lime/30 transition-all cursor-pointer group"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-ninpo-lime/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-ninpo-lime" />
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="text-white font-bold text-sm mb-1 group-hover:text-ninpo-lime transition-colors">
                  {rec.productName}
                </h4>
                
                <p className="text-slate-400 text-xs mb-2">
                  {rec.reason}
                </p>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                    {rec.category}
                  </span>
                  <span className="text-slate-600">•</span>
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-1.5 bg-ninpo-midnight rounded-full overflow-hidden">
                      <div
                        className="h-full bg-ninpo-lime rounded-full transition-all"
                        style={{ width: `${rec.confidence}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {rec.confidence}% match
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <p className="text-xs text-slate-500 text-center">
          Powered by Gemini AI • Based on your order history
        </p>
      </div>
    </div>
  );
};
