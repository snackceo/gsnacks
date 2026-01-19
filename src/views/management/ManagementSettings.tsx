import React from 'react';
import { AppSettings } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';

interface ManagementSettingsProps {
  settingsDraft: AppSettings;
  setSettingsDraft: (draft: AppSettings) => void;
  settingsDirty: boolean;
  setSettingsDirty: (dirty: boolean) => void;
  isSavingSettings: boolean;
  setIsSavingSettings: (saving: boolean) => void;
  settingsError: string | null;
  setSettingsError: (error: string | null) => void;
  settingsSaved: boolean;
  setSettingsSaved: (saved: boolean) => void;
  updateSettingsDraft: (updates: Partial<AppSettings>) => void;
  saveSettings: () => void;
}

const ManagementSettings: React.FC<ManagementSettingsProps> = ({
  settingsDraft,
  setSettingsDraft,
  settingsDirty,
  setSettingsDirty,
  isSavingSettings,
  setIsSavingSettings,
  settingsError,
  setSettingsError,
  settingsSaved,
  setSettingsSaved,
  updateSettingsDraft,
  saveSettings
}) => {
  const { addToast } = useNinpoCore();

  React.useEffect(() => {
    if (settingsSaved) {
      console.log('[ManagementSettings] Showing success toast');
      addToast('Settings saved successfully!', 'success');
      setTimeout(() => setSettingsSaved(false), 100);
    }
    if (settingsError) {
      console.log('[ManagementSettings] Showing error toast:', settingsError);
      addToast(settingsError, 'error');
      setTimeout(() => setSettingsError(null), 100);
    }
  }, [settingsSaved, settingsError, addToast, setSettingsSaved, setSettingsError])

  return (
    <form
      className="space-y-8 max-w-2xl mx-auto bg-ninpo-card p-8 rounded-[2.5rem] border border-white/10 shadow-neon"
      onSubmit={e => {
        e.preventDefault();
        console.log('[ManagementSettings form] onSubmit called, calling saveSettings()');
        saveSettings();
      }}
    >
      <h2 className="text-2xl font-black uppercase tracking-widest mb-6 text-ninpo-black">App Settings</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Numeric fields */}
        <label className="text-sm font-bold text-slate-300">Route Fee
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.routeFee} onChange={e => updateSettingsDraft({ routeFee: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Referral Bonus
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.referralBonus} onChange={e => updateSettingsDraft({ referralBonus: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Pickup Only Multiplier
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.pickupOnlyMultiplier} onChange={e => updateSettingsDraft({ pickupOnlyMultiplier: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Included Miles
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceIncludedMiles} onChange={e => updateSettingsDraft({ distanceIncludedMiles: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Band 1 Max Miles
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceBand1MaxMiles} onChange={e => updateSettingsDraft({ distanceBand1MaxMiles: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Band 2 Max Miles
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceBand2MaxMiles} onChange={e => updateSettingsDraft({ distanceBand2MaxMiles: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Band 1 Rate
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceBand1Rate} onChange={e => updateSettingsDraft({ distanceBand1Rate: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Band 2 Rate
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceBand2Rate} onChange={e => updateSettingsDraft({ distanceBand2Rate: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Distance Band 3 Rate
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.distanceBand3Rate} onChange={e => updateSettingsDraft({ distanceBand3Rate: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Hub Latitude
          <input type="number" step="0.000001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.hubLat ?? ''} onChange={e => updateSettingsDraft({ hubLat: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Hub Longitude
          <input type="number" step="0.000001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.hubLng ?? ''} onChange={e => updateSettingsDraft({ hubLng: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Daily Return Limit
          <input type="number" step="1" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.dailyReturnLimit} onChange={e => updateSettingsDraft({ dailyReturnLimit: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Glass Handling Fee Percent
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.glassHandlingFeePercent} onChange={e => updateSettingsDraft({ glassHandlingFeePercent: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Michigan Deposit Value
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.michiganDepositValue} onChange={e => updateSettingsDraft({ michiganDepositValue: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Processing Fee Percent
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.processingFeePercent} onChange={e => updateSettingsDraft({ processingFeePercent: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Return Processing Fee Percent
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.returnProcessingFeePercent} onChange={e => updateSettingsDraft({ returnProcessingFeePercent: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Glass Handling Fee Per Container
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.glassHandlingFeePerContainer} onChange={e => updateSettingsDraft({ glassHandlingFeePerContainer: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Return Handling Fee Per Container
          <input type="number" step="0.0001" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.returnHandlingFeePerContainer} onChange={e => updateSettingsDraft({ returnHandlingFeePerContainer: Number(e.target.value) })} />
        </label>

        {/* Handling fees */}
        <label className="text-sm font-bold text-slate-300">Large Order Included Items
          <input type="number" step="1" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.largeOrderIncludedItems} onChange={e => updateSettingsDraft({ largeOrderIncludedItems: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Large Order Per-Item Fee
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.largeOrderPerItemFee} onChange={e => updateSettingsDraft({ largeOrderPerItemFee: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold text-slate-300">Heavy Item Fee Per Unit
          <input type="number" step="0.01" className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full mt-2" value={settingsDraft.heavyItemFeePerUnit} onChange={e => updateSettingsDraft({ heavyItemFeePerUnit: Number(e.target.value) })} />
        </label>

        {/* Boolean fields */}
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.maintenanceMode} onChange={e => updateSettingsDraft({ maintenanceMode: e.target.checked })} />
          Maintenance Mode
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.requirePhotoForRefunds} onChange={e => updateSettingsDraft({ requirePhotoForRefunds: e.target.checked })} />
          Require Photo For Refunds
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.allowGuestCheckout} onChange={e => updateSettingsDraft({ allowGuestCheckout: e.target.checked })} />
          Allow Guest Checkout
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.showAdvancedInventoryInsights} onChange={e => updateSettingsDraft({ showAdvancedInventoryInsights: e.target.checked })} />
          Show Advanced Inventory Insights
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.allowPlatinumTier} onChange={e => updateSettingsDraft({ allowPlatinumTier: e.target.checked })} />
          Allow Platinum Tier
        </label>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-300">
          <input type="checkbox" checked={!!settingsDraft.platinumFreeDelivery} onChange={e => updateSettingsDraft({ platinumFreeDelivery: e.target.checked })} />
          Platinum Free Delivery
        </label>
      </div>
      <button
        type="submit"
        className="bg-ninpo-lime text-ninpo-black font-black px-8 py-4 rounded-2xl mt-8 shadow-neon text-lg tracking-widest uppercase"
        disabled={isSavingSettings}
      >
        {isSavingSettings ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  );
};

export default ManagementSettings;
