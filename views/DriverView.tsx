
import React, { useState } from 'react';
import { Order, OrderStatus, User } from '../types';
import { MapPin, Navigation, Camera, CheckCircle, Package, AlertCircle, Zap } from 'lucide-react';

interface DriverViewProps {
  orders: Order[];
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  user: User;
}

const DriverView: React.FC<DriverViewProps> = ({ orders, updateOrderStatus, user }) => {
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const availableOrders = orders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.ASSIGNED || o.status === OrderStatus.OUT_FOR_DELIVERY);

  const handleStartDelivery = (order: Order) => {
    updateOrderStatus(order.id, OrderStatus.OUT_FOR_DELIVERY);
    setActiveOrder(order);
  };

  const handleCompleteDelivery = (order: Order) => {
    updateOrderStatus(order.id, OrderStatus.DELIVERED);
    setActiveOrder(null);
    alert("Target Reached! Credits deployed to Custo.");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">
            NINJA <span className="text-lime-500">OPS</span>
          </h1>
          <p className="text-slate-400 font-black uppercase text-[10px] tracking-[0.3em] mt-2">Active Field Agent: {user.name}</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-2.5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl">
          <div className="w-2.5 h-2.5 bg-lime-500 rounded-full animate-ping"></div>
          Signal: Stealth
        </div>
      </div>

      {activeOrder ? (
        <div className="bg-white rounded-[3rem] border border-slate-100 shadow-2xl overflow-hidden relative">
          <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-lime-50/20">
            <div>
              <p className="text-[10px] font-black text-lime-600 uppercase tracking-widest mb-1">Active Objective</p>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">{activeOrder.id}</h2>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest">
              <Zap className="w-3 h-3 text-lime-500 animate-pulse" /> IN TRANSIT
            </div>
          </div>
          
          <div className="p-10 space-y-12">
            <div className="flex gap-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg"><Package className="w-7 h-7" /></div>
                <div className="w-1 h-20 bg-slate-100 rounded-full border border-slate-50"></div>
                <div className="w-14 h-14 rounded-2xl bg-lime-500 flex items-center justify-center text-slate-900 shadow-lg shadow-lime-500/20"><MapPin className="w-7 h-7" /></div>
              </div>
              <div className="space-y-12 pt-2 flex-1">
                <div>
                  <h4 className="font-black text-slate-400 uppercase tracking-widest text-[10px] mb-2">Extraction Point</h4>
                  <p className="text-xl font-black text-slate-900 leading-tight uppercase tracking-tight">Ninpo Dojo Hub A<br/><span className="text-sm font-bold text-slate-400 normal-case">Logistics Sector, Michigan</span></p>
                </div>
                <div>
                  <h4 className="font-black text-lime-600 uppercase tracking-widest text-[10px] mb-2">Custo Drop-off</h4>
                  <p className="text-xl font-black text-slate-900 leading-tight uppercase tracking-tight">Private Residence Alpha<br/><span className="text-sm font-bold text-slate-400 normal-case">Residential Sector, MI</span></p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-10 border-t border-slate-50">
              <button className="flex items-center justify-center gap-3 py-6 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 font-black uppercase tracking-widest hover:bg-slate-50 hover:border-lime-500 hover:text-lime-600 transition-all group">
                <Camera className="w-6 h-6 group-hover:scale-110 transition-transform" /> Photo Proof
              </button>
              <button 
                onClick={() => handleCompleteDelivery(activeOrder)}
                className="flex items-center justify-center gap-3 py-6 bg-lime-500 text-white rounded-[2rem] font-black uppercase tracking-widest hover:bg-lime-600 shadow-2xl shadow-lime-500/30 active:scale-95 transition-all"
              >
                <CheckCircle className="w-6 h-6" /> Mission Complete
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
               <AlertCircle className="text-amber-500 w-6 h-6" />
               Pending Missions ({availableOrders.length})
            </h3>
            <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg uppercase tracking-widest">LIVE FEED</span>
          </div>
          
          {availableOrders.length === 0 ? (
            <div className="p-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
              <p className="text-slate-300 font-black uppercase tracking-widest text-sm italic">Scanning for new signals...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {availableOrders.map(order => (
                <div key={order.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8 hover:shadow-2xl hover:border-lime-200 transition-all group animate-in slide-in-from-bottom-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-3">
                      <span className="text-[10px] font-black text-lime-600 bg-lime-50 px-4 py-1.5 rounded-full uppercase tracking-widest border border-lime-100">{order.id}</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" /> {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <h4 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Snack Delivery • ${order.total.toFixed(2)}</h4>
                    <p className="text-xs font-bold text-slate-400 flex items-center gap-2 mt-3">
                      <MapPin className="w-4 h-4 text-lime-500" /> MI Local Target Area • 1.2 KM Distant
                    </p>
                  </div>
                  <button 
                    onClick={() => handleStartDelivery(order)}
                    className="w-full sm:w-auto px-12 py-5 bg-slate-900 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-widest hover:bg-lime-500 hover:text-slate-900 shadow-xl shadow-slate-100 transition-all"
                  >
                    Accept Contract
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function ClockIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export default DriverView;
